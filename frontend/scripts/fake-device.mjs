#!/usr/bin/env node
// SYNTHETIC TEST DEVICE. This is a test tool, not part of the website or the
// firmware. It pretends to be the MotionTrack ESP32 so the website and backend
// can be tried without hardware. Every heart rate and repetition it sends is
// made up, so it proves nothing about the real device, its sensors or its
// firmware.
//
// It speaks the rep-exercise device protocol the way the firmware does:
// - polls GET /api/device/workout about once a second;
// - on entering each step it first reports what the device is doing (a status
//   event: "waiting_finger" and then "reading" for a heart-rate check,
//   "counting" for reps), so the website never shows an old device line;
// - sends before_bpm, cumulative progress and after_bpm events with increasing
//   sequence numbers, continuing from the server's last_sequence;
// - follows the server when the website is ahead (Skip reading, Stop exercise);
// - runs one exercise, then exits once that exercise is closed.
//
// Usage (from frontend/):
//   DEVICE_TOKEN=<token the website showed once> npm run fake-device -- [options]
// Options:
//   --bpm-before N  heart rate sent for the reading before exercise (default 78)
//   --bpm-after N   heart rate sent for the reading after exercise (default 104)
//   --rep-ms N      milliseconds per repetition (default 800)
//   --weak-ms N     report a weak signal for N ms in each reading before it succeeds (default 0)
//   --no-after-bpm  never finish the reading after exercise: keep reporting
//                   "waiting for finger" / "weak signal" until the website skips it
//   --retry-last    after the first counted rep, send that upload again byte for
//                   byte and print the server's reply ("duplicate"; nothing changes)
// API_BASE_URL sets the backend (default http://127.0.0.1:3000). The token is never printed.

const USAGE = 'Usage: DEVICE_TOKEN=<token> npm run fake-device -- [--bpm-before 78] [--bpm-after 104] '
  + '[--rep-ms 800] [--weak-ms 0] [--no-after-bpm] [--retry-last]';

const POLL_MS = 1000; // how often the device asks the server for its exercise
const FINGER_MS = 1500; // "PLACE YOUR FINGER" before the reading starts
const HOLD_MS = 2000; // "Hold still" while a reading is taken
const CYCLE_MS = 2000; // --no-after-bpm: time between "waiting for finger" and "weak signal"
const RETRY_PAUSE_MS = 3000; // --retry-last: pause after the resend so the unchanged count can be seen
const TIMEOUT_MS = 3000; // per HTTP request, as on the device

function usageError(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function parseOptions(argv) {
  const options = { bpmBefore: 78, bpmAfter: 104, repMs: 800, weakMs: 0, noAfterBpm: false, retryLast: false };
  const numbers = {
    '--bpm-before': ['bpmBefore', 1, 300],
    '--bpm-after': ['bpmAfter', 1, 300],
    '--rep-ms': ['repMs', 50, 60_000],
    '--weak-ms': ['weakMs', 0, 600_000],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--no-after-bpm') options.noAfterBpm = true;
    else if (arg === '--retry-last') options.retryLast = true;
    else if (numbers[arg]) {
      const [key, min, max] = numbers[arg];
      i += 1;
      const value = Number(argv[i]);
      if (argv[i] === undefined || !Number.isInteger(value) || value < min || value > max) {
        usageError(`${arg} needs a whole number from ${min} to ${max}.`);
      }
      options[key] = value;
    } else usageError(`Unknown option: ${arg}`);
  }
  return options;
}

console.log('SYNTHETIC TEST DEVICE - made-up heart rates and reps for testing only, not sensor data.');
const options = parseOptions(process.argv.slice(2));
const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = process.env.DEVICE_TOKEN;
if (!TOKEN) usageError('Set DEVICE_TOKEN to the device token the website showed when the device was added.');

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const log = text => console.log(text);

const PHASE_TEXT = {
  before_bpm: 'Step 1: heart rate before exercise (PLACE YOUR FINGER)',
  counting: 'Step 2: counting reps',
  after_bpm: 'Step 3: heart rate after exercise (PLACE YOUR FINGER)',
};
const STATUS_TEXT = {
  waiting_finger: 'waiting for finger',
  reading: 'hold still - reading',
  weak_signal: 'weak signal - trying again',
  counting: 'counting',
};

// One HTTP request. Returns { status, data }, or null when the server could not be reached.
async function http(method, path, body) {
  try {
    const response = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  } catch {
    return null;
  }
}

function stop(message, code) {
  (code ? console.error : console.log)(message);
  process.exit(code);
}

function checkToken(reply) {
  if (reply?.status === 401) {
    stop('The server refused the device token (401). Add the device again on the website and use the new token.', 1);
  }
}

async function poll() {
  for (;;) {
    const reply = await http('GET', '/api/device/workout');
    checkToken(reply);
    if (reply?.status === 200 && reply.data) return reply.data.workout;
    log(`Could not ask the server for an exercise (${reply ? reply.status : 'server not reachable'}); trying again in 1 s`);
    await sleep(1000);
  }
}

// Sends one upload until the server answers it: 2xx or 409 end it, anything
// transient is retried with the same bytes (like the firmware's outbox).
async function deliver(path, body) {
  for (;;) {
    const reply = await http('POST', path, body);
    checkToken(reply);
    if (reply && reply.status < 500 && reply.status !== 429) {
      if (reply.status >= 400 && reply.status !== 409) {
        stop(`The server rejected an upload (${reply.status}): ${reply.data?.error?.message ?? 'no message'}`, 1);
      }
      return reply;
    }
    log(`Upload not delivered (${reply ? reply.status : 'server not reachable'}); sending the same upload again in 1 s`);
    await sleep(1000);
  }
}

let exercise = null; // { id, name, target, reps, phase, announced } for the exercise this run works on
let sequence = 0; // the last sequence number used
let lastAck = null; // { path, body, sequence } of the last upload the server accepted
let retried = false;
let stage = 0; // position inside the current heart-rate reading
let actAt = Infinity; // when the next device action is due
let pollAt = 0;
let pollNow = false;

function enter(phase, delay = 0) {
  exercise.phase = phase;
  exercise.announced = false;
  stage = 0;
  actAt = Date.now() + delay;
  if (PHASE_TEXT[phase]) log(PHASE_TEXT[phase]);
}

// Applies the server's view of the exercise. Returns true when the device can
// carry on with its current step, false when the step changed.
function follow(server, own) {
  exercise.reps = server.repetitions;
  if (server.phase === exercise.phase) return true;
  if (!own) log(`The website moved this exercise on (now ${server.phase}); following the server.`);
  if (server.phase === 'done' || !['pending', 'active'].includes(server.status)) {
    exercise.phase = 'done';
    actAt = Infinity;
    pollNow = true;
    log(`${exercise.name} finished on the server: ${server.status}, ${server.repetitions} / ${exercise.target} reps.`);
    return false;
  }
  enter(server.phase);
  return false;
}

// Sends one new event. Returns the server's reply data, or null after a 409
// (the server has moved on; the next poll decides what the device does).
async function upload(fields) {
  sequence += 1;
  const path = `/api/device/workouts/${exercise.id}/updates`;
  const body = JSON.stringify({ sequence, ...fields });
  const reply = await deliver(path, body);
  if (reply.status === 409) {
    const phase = reply.data?.error?.phase;
    log(`#${sequence} refused: ${reply.data?.error?.message ?? 'conflict'}${phase ? ` (server phase: ${phase})` : ''}. Checking the server...`);
    actAt = Infinity;
    pollNow = true;
    return null;
  }
  lastAck = { path, body, sequence };
  return reply.data;
}

async function sendStatus(status) {
  const data = await upload({ event: 'status', capture_status: status });
  if (!data) return false;
  log(`#${sequence} status: ${STATUS_TEXT[status]}`);
  return follow(data.workout, false);
}

async function retryLast() {
  log(`Retry test: sending upload #${lastAck.sequence} again, byte for byte...`);
  const reply = await deliver(lastAck.path, lastAck.body);
  if (reply.status === 200 && reply.data?.duplicate === true) {
    log(`Server reply: duplicate (#${lastAck.sequence} was already saved; nothing changed, `
      + `still ${reply.data.workout.repetitions} / ${exercise.target} reps)`);
  } else {
    log(`Server reply: ${reply.status} ${reply.data?.duplicate === false ? 'saved as NEW data (not a duplicate!)' : reply.data?.error?.message ?? ''}`);
  }
}

async function actReading() {
  const which = exercise.phase === 'before_bpm' ? 'before' : 'after';
  if (which === 'after' && options.noAfterBpm) {
    if (await sendStatus(stage % 2 === 0 ? 'waiting_finger' : 'weak_signal')) {
      stage += 1;
      actAt = Date.now() + CYCLE_MS;
    }
    return;
  }
  const steps = [
    { status: 'waiting_finger', ms: FINGER_MS },
    ...(options.weakMs > 0 ? [{ status: 'weak_signal', ms: options.weakMs }] : []),
    { status: 'reading', ms: HOLD_MS },
  ];
  const step = steps[stage];
  if (step) {
    if (await sendStatus(step.status)) {
      stage += 1;
      actAt = Date.now() + step.ms;
    }
    return;
  }
  const bpm = which === 'before' ? options.bpmBefore : options.bpmAfter;
  const data = await upload({ event: `${which}_bpm`, bpm });
  if (!data) return;
  log(`#${sequence} heart rate ${which} exercise: ${bpm} bpm (synthetic)`);
  follow(data.workout, true);
}

async function actCounting() {
  if (!exercise.announced) {
    if (await sendStatus('counting')) {
      exercise.announced = true;
      actAt = Date.now() + options.repMs;
    }
    return;
  }
  if (exercise.reps >= exercise.target) {
    actAt = Infinity; // the server moves on to the reading after exercise
    pollNow = true;
    return;
  }
  const data = await upload({ event: 'progress', repetitions: exercise.reps + 1 });
  if (!data) return;
  log(`#${sequence} rep ${data.workout.repetitions} / ${exercise.target}`);
  let pause = 0;
  if (options.retryLast && !retried) {
    retried = true;
    await retryLast();
    pause = RETRY_PAUSE_MS;
  }
  // Still counting: next rep after rep-ms. Target reached: the server is now in
  // the reading after exercise, which starts at once (or after the retry pause).
  const counting = follow(data.workout, true);
  if (exercise.phase !== 'done') actAt = Date.now() + (counting ? Math.max(pause, options.repMs) : pause);
}

let waitingShown = false;
let oldShown = false;

function onPoll(server) {
  if (!server || (exercise && server.id !== exercise.id)) {
    if (exercise) {
      stop(exercise.phase === 'done'
        ? 'Done. The device stops here; run the script again for the next exercise.'
        : `${exercise.name} was closed on the website (stopped, skipped or session ended). The device stops here.`, 0);
    }
    if (!waitingShown) log('Waiting for the website to start an exercise on this device (checking every second)...');
    waitingShown = true;
    return;
  }
  if (server.kind !== 'reps') {
    if (!oldShown) log('Old workout - cancel it on the website. (This device only runs rep exercises.)');
    oldShown = true;
    return;
  }
  sequence = Math.max(sequence, server.last_sequence);
  if (!exercise) {
    exercise = { id: server.id, name: server.exercise_name, target: server.target_reps, reps: server.repetitions, phase: null };
    log(`Exercise: ${exercise.name}, target ${exercise.target} reps`
      + (server.last_sequence ? ` (resuming: ${server.repetitions} reps, uploads up to #${server.last_sequence} already saved)` : ''));
    enter(server.phase);
    return;
  }
  if (exercise.phase !== 'done') follow(server, false);
}

for (;;) {
  if (pollNow || Date.now() >= pollAt) {
    pollNow = false;
    onPoll(await poll());
    pollAt = Date.now() + POLL_MS;
  }
  if (exercise && Date.now() >= actAt) {
    if (exercise.phase === 'counting') await actCounting();
    else if (exercise.phase === 'before_bpm' || exercise.phase === 'after_bpm') await actReading();
  }
  const wait = Math.min(pollAt, actAt) - Date.now();
  if (!pollNow && wait > 0) await sleep(wait);
}

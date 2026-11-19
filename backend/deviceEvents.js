import { bodyFields, fail, integer } from './validate.js';

const CAPTURE_STATUSES = ['waiting_finger', 'reading', 'weak_signal', 'counting'];
const EVENTS = ['status', 'before_bpm', 'progress', 'after_bpm'];
const PHASES = {
  status: ['before_bpm', 'counting', 'after_bpm'],
  before_bpm: ['before_bpm'],
  progress: ['counting'],
  after_bpm: ['after_bpm'],
};

function parse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'A JSON object is required');
  const event = body.event;
  if (!EVENTS.includes(event)) fail(400, `event must be one of: ${EVENTS.join(', ')}`);
  const field = event === 'status' ? 'capture_status' : event === 'progress' ? 'repetitions' : 'bpm';
  bodyFields(body, ['sequence', 'event', field]);
  const sequence = integer(body.sequence, 'sequence', 1, 2_147_483_647);
  const parsed = { sequence, event, repetitions: null, bpm: null, capture_status: null };
  if (event === 'status') {
    if (!CAPTURE_STATUSES.includes(body.capture_status)) fail(400, `capture_status must be one of: ${CAPTURE_STATUSES.join(', ')}`);
    parsed.capture_status = body.capture_status;
  } else if (event === 'progress') {
    parsed.repetitions = integer(body.repetitions, 'repetitions', 0, 1_000_000);
  } else {
    parsed.bpm = integer(body.bpm, 'bpm', 1, 300);
  }
  return parsed;
}

// Applies one device upload to a rep workout. Call inside a transaction.
export async function applyDeviceEvent(db, workout, body, now) {
  const e = parse(body);
  const reload = () => db.get('SELECT * FROM workouts WHERE id = ?', workout.id);
  const existing = await db.get('SELECT * FROM workout_events WHERE workout_id = ? AND sequence = ?', workout.id, e.sequence);
  if (existing) {
    if (existing.type !== e.event || existing.repetitions !== e.repetitions || existing.bpm !== e.bpm ||
      existing.capture_status !== e.capture_status) fail(409, 'Sequence already exists with different data');
    await db.run('UPDATE workouts SET device_seen_at = ? WHERE id = ?', now, workout.id);
    return { workout: await reload(), duplicate: true };
  }
  if (!['pending', 'active'].includes(workout.status)) fail(409, 'Workout has ended', { phase: workout.phase });
  if (e.sequence <= workout.last_sequence) fail(409, 'Sequence must increase', { phase: workout.phase });
  if (e.event === 'progress' && e.repetitions > workout.target_reps) {
    fail(400, `repetitions cannot exceed the target of ${workout.target_reps}`);
  }
  if (!PHASES[e.event].includes(workout.phase)) {
    fail(409, `Event ${e.event} is not allowed in phase ${workout.phase}`, { phase: workout.phase });
  }
  if (e.event === 'progress' && e.repetitions < workout.repetitions) {
    fail(409, 'Cumulative repetitions cannot decrease', { phase: workout.phase });
  }

  await db.run(`INSERT INTO workout_events (workout_id, sequence, type, repetitions, bpm, capture_status, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, workout.id, e.sequence, e.event, e.repetitions, e.bpm, e.capture_status, now);
  const base = 'status = \'active\', last_sequence = ?, device_seen_at = ?, updated_at = ?';
  const common = [e.sequence, now, now];
  if (e.event === 'status') {
    await db.run(`UPDATE workouts SET ${base}, device_status = ? WHERE id = ?`, ...common, e.capture_status, workout.id);
  } else if (e.event === 'before_bpm') {
    await db.run(`UPDATE workouts SET ${base}, before_bpm = ?, before_bpm_at = ?, phase = 'counting',
      started_at = COALESCE(started_at, ?) WHERE id = ?`, ...common, e.bpm, now, now, workout.id);
  } else if (e.event === 'progress') {
    const phase = e.repetitions === workout.target_reps ? 'after_bpm' : 'counting';
    await db.run(`UPDATE workouts SET ${base}, repetitions = ?, phase = ?, device_status = 'counting',
      started_at = COALESCE(started_at, ?) WHERE id = ?`, ...common, e.repetitions, phase, now, workout.id);
  } else {
    const complete = workout.repetitions === workout.target_reps && workout.before_bpm !== null;
    await db.run(`UPDATE workouts SET ${base}, after_bpm = ?, after_bpm_at = ?, phase = 'done', status = ?, ended_at = ?
      WHERE id = ?`, ...common, e.bpm, now, complete ? 'completed' : 'incomplete', now, workout.id);
  }
  return { workout: await reload(), duplicate: false };
}

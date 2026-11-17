#!/usr/bin/env node
// TEST ONLY: pretends to be an ESP32 so the website can be checked without
// hardware. It sends SYNTHETIC numbers to the real backend device routes.
// It is not part of the website and proves nothing about the real device or sensors.
//
// Usage (from frontend/):
//   DEVICE_TOKEN=<token shown once by the website> npm run fake-device -- [options]
// Options:
//   --seconds N         number of one-second updates to send (default 20)
//   --no-heart-rate     never send a heart rate (every sample is null)
//   --drop-heart-rate N send heart rate only for the first N updates, then null
//   --no-complete       stop without the final completed:true upload
//   --pause N           after half the updates, send nothing for N seconds
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : Number(args[index + 1]);
};

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const token = process.env.DEVICE_TOKEN;
if (!token) {
  console.error('Set DEVICE_TOKEN to the device token the website showed when the device was added.');
  process.exit(1);
}
const seconds = option('--seconds', 20);
const dropAfter = flag('--no-heart-rate') ? 0 : option('--drop-heart-rate', Infinity);
const pause = option('--pause', 0);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(path, body) {
  const response = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${data.error?.message}`);
  return data;
}

console.log('SYNTHETIC TEST DEVICE - these are made-up numbers, not sensor data.');
let workout = null;
while (!workout) {
  ({ workout } = await call('/api/device/workout'));
  if (!workout) {
    console.log('No workout is waiting for this device. Set one up on the website... (checking again in 2 s)');
    await sleep(2000);
  }
}
console.log(`Workout: ${workout.exercise_name}, planned ${workout.target_duration_seconds} s. "Pressing start" now.`);

let sequence = workout.last_sequence;
let repetitions = workout.repetitions;
let elapsed = workout.elapsed_seconds;
for (let i = 1; i <= seconds; i += 1) {
  await sleep(1000);
  if (pause && i === Math.ceil(seconds / 2)) {
    console.log(`Pausing uploads for ${pause} s (simulated Wi-Fi drop)`);
    await sleep(pause * 1000);
    elapsed += pause;
  }
  sequence += 1;
  elapsed += 1;
  if (i % 2 === 0) repetitions += 1;
  const completed = i === seconds && !flag('--no-complete');
  const heart_rate_bpm = i <= dropAfter ? 85 + Math.round(10 * Math.sin(i / 3)) + Math.min(i, 15) : null;
  await call(`/api/device/workouts/${workout.id}/updates`, { sequence, repetitions, elapsed_seconds: elapsed, heart_rate_bpm, completed });
  console.log(`#${sequence} reps=${repetitions} elapsed=${elapsed}s heart=${heart_rate_bpm ?? 'none'}${completed ? ' (final)' : ''}`);
}
console.log('Done.');

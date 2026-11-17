import { isFinished } from './format.js';

// A heart-rate reading is "live" only when the newest non-null sample reached
// the server within this window. Older than this, it is shown as stale.
export const STALE_AFTER_MS = 5000;

export function latestHeartRateReading(readings) {
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    if (readings[i].heart_rate_bpm != null) return readings[i];
  }
  return null;
}

// kind: 'none'  - no heart rate has been recorded (never shown as 0)
//       'live'  - newest non-null reading is at most STALE_AFTER_MS old
//       'stale' - a value exists but is old, or we lost contact with the server
//       'final' - the workout has ended; the value is the last one recorded
export function heartRateState({ workout, readings, now, disconnected }) {
  const latest = latestHeartRateReading(readings);
  const bpm = latest?.heart_rate_bpm ?? workout?.heart_rate_bpm ?? null;
  if (bpm == null) return { kind: 'none', bpm: null, receivedAt: null, ageMs: null };
  const receivedAt = latest?.received_at ?? null;
  const ageMs = receivedAt ? Math.max(0, now - Date.parse(receivedAt)) : null;
  if (workout && isFinished(workout.status)) return { kind: 'final', bpm, receivedAt, ageMs };
  if (disconnected || ageMs == null || ageMs > STALE_AFTER_MS) return { kind: 'stale', bpm, receivedAt, ageMs };
  return { kind: 'live', bpm, receivedAt, ageMs };
}

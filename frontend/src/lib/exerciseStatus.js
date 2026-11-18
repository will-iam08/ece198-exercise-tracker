// Plain-language labels for one rep exercise (a `workouts` row of kind
// "reps"). A missing heart rate is never shown as a number.

export const STALE_AFTER_MS = 5000;

const OPEN_STATUSES = ['pending', 'active'];

export function isOpen(workout) {
  return OPEN_STATUSES.includes(workout?.status);
}

// Phases that come after each reading.
const AFTER_PHASE = {
  before: ['counting', 'after_bpm', 'done'],
  after: ['done'],
};

// "78 bpm" | "Skipped" | "No reading" | "Waiting"
export function bpmLabel(workout, which) {
  const bpm = workout[`${which}_bpm`];
  if (bpm !== null && bpm !== undefined) return `${bpm} bpm`;
  if (workout[`${which}_skipped`]) return 'Skipped';
  if (!isOpen(workout) || AFTER_PHASE[which].includes(workout.phase)) return 'No reading';
  return 'Waiting';
}

const STATUS_LABELS = {
  pending: 'Not started yet',
  active: 'In progress',
  completed: 'Complete',
  incomplete: 'Incomplete',
  cancelled: 'Cancelled',
};

export function statusLabel(workout) {
  return STATUS_LABELS[workout.status] ?? workout.status;
}

const DEVICE_LINES = {
  waiting_finger: 'Place your finger on the sensor',
  reading: 'Hold still — reading',
  weak_signal: 'Signal weak — trying again',
  counting: 'Counting',
};

const READING_STATUSES = ['waiting_finger', 'reading', 'weak_signal'];

// What the device is doing now, according to its last report. A report that
// belongs to the previous step (for example "counting" just after the target
// was reached) is not shown as current.
export function deviceLine(workout) {
  if (!isOpen(workout)) return '';
  const status = workout.device_status;
  if (!DEVICE_LINES[status]) return 'Waiting for the device';
  if (workout.phase === 'counting' && status !== 'counting') return 'Waiting for the device';
  if ((workout.phase === 'before_bpm' || workout.phase === 'after_bpm') && !READING_STATUSES.includes(status)) {
    return 'Waiting for the device';
  }
  return DEVICE_LINES[status];
}

// Time since the device last contacted the server about this exercise. Both
// times come from the server clock, so the browser's clock does not matter.
export function contactAgeMs(workout, serverTime) {
  const now = typeof serverTime === 'number' ? serverTime : Date.parse(serverTime);
  const seen = Date.parse(workout.device_seen_at ?? workout.created_at);
  if (!Number.isFinite(now) || !Number.isFinite(seen)) return null;
  return Math.max(0, now - seen);
}

export function isStale(workout, serverTime) {
  if (!isOpen(workout) || serverTime === null || serverTime === undefined) return false;
  const age = contactAgeMs(workout, serverTime);
  return age !== null && age > STALE_AFTER_MS;
}

export function notRespondingText(workout, serverTime) {
  const seconds = Math.round((contactAgeMs(workout, serverTime) ?? 0) / 1000);
  return `Device not responding (last update ${seconds} s ago)`;
}

// The session with one exercise added or replaced, for showing the result of
// an action before the next poll arrives.
export function withWorkout(session, workout) {
  const exists = session.workouts.some(item => item.id === workout.id);
  return {
    ...session,
    workouts: exists ? session.workouts.map(item => (item.id === workout.id ? workout : item)) : [...session.workouts, workout],
  };
}

// The rep target typed by the patient -> a whole number from 1 to 50.
export function parseTargetReps(input) {
  const text = String(input ?? '').trim();
  if (!/^\d+$/.test(text)) return { error: 'Enter the number of reps as a whole number from 1 to 50.' };
  const reps = Number(text);
  if (reps < 1 || reps > 50) return { error: 'The number of reps must be from 1 to 50.' };
  return { reps };
}

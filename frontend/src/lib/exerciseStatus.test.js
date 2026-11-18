import { describe, expect, it } from 'vitest';
import {
  bpmLabel, contactAgeMs, deviceLine, isOpen, isStale, notRespondingText, parseTargetReps, STALE_AFTER_MS, statusLabel, withWorkout,
} from './exerciseStatus.js';

const base = {
  id: 'w1',
  kind: 'reps',
  exercise_name: 'Arm Curl',
  target_reps: 10,
  repetitions: 0,
  phase: 'before_bpm',
  status: 'pending',
  before_bpm: null,
  before_bpm_at: null,
  after_bpm: null,
  after_bpm_at: null,
  before_skipped: 0,
  after_skipped: 0,
  device_status: null,
  device_seen_at: null,
  created_at: '2026-11-18T15:00:00.000Z',
};
const workout = changes => ({ ...base, ...changes });

describe('bpmLabel', () => {
  it('shows a recorded reading with its unit', () => {
    expect(bpmLabel(workout({ before_bpm: 104, phase: 'counting', status: 'active' }), 'before')).toBe('104 bpm');
    expect(bpmLabel(workout({ before_bpm: 78, after_bpm: 104, phase: 'done', status: 'completed' }), 'after')).toBe('104 bpm');
  });

  it('says Skipped when the patient skipped the reading', () => {
    expect(bpmLabel(workout({ before_skipped: 1, phase: 'counting', status: 'active' }), 'before')).toBe('Skipped');
    expect(bpmLabel(workout({ after_skipped: 1, phase: 'done', status: 'incomplete' }), 'after')).toBe('Skipped');
  });

  it('says No reading when the phase has passed without a reading', () => {
    // Stopped during the before reading.
    expect(bpmLabel(workout({ phase: 'done', status: 'incomplete' }), 'before')).toBe('No reading');
    expect(bpmLabel(workout({ phase: 'done', status: 'incomplete' }), 'after')).toBe('No reading');
    // An ended exercise never waits, whatever its phase says.
    expect(bpmLabel(workout({ phase: 'counting', status: 'incomplete' }), 'after')).toBe('No reading');
  });

  it('says Waiting when the phase has not been reached or is in progress', () => {
    expect(bpmLabel(workout({}), 'before')).toBe('Waiting');
    expect(bpmLabel(workout({}), 'after')).toBe('Waiting');
    expect(bpmLabel(workout({ before_bpm: 80, phase: 'counting', status: 'active' }), 'after')).toBe('Waiting');
    expect(bpmLabel(workout({ before_bpm: 80, phase: 'after_bpm', status: 'active' }), 'after')).toBe('Waiting');
  });

  it('never turns a missing reading into 0', () => {
    expect(bpmLabel(workout({ before_bpm: null, phase: 'done', status: 'incomplete' }), 'before')).not.toMatch(/0/);
  });
});

describe('statusLabel', () => {
  it('uses plain words for every status', () => {
    expect(statusLabel(workout({ status: 'pending' }))).toBe('Not started yet');
    expect(statusLabel(workout({ status: 'active' }))).toBe('In progress');
    expect(statusLabel(workout({ status: 'completed' }))).toBe('Complete');
    expect(statusLabel(workout({ status: 'incomplete' }))).toBe('Incomplete');
    expect(statusLabel(workout({ status: 'cancelled' }))).toBe('Cancelled');
  });
});

describe('deviceLine', () => {
  it('maps each device status to plain words', () => {
    expect(deviceLine(workout({ device_status: 'waiting_finger' }))).toBe('Place your finger on the sensor');
    expect(deviceLine(workout({ device_status: 'reading' }))).toBe('Hold still — reading');
    expect(deviceLine(workout({ device_status: 'weak_signal' }))).toBe('Signal weak — trying again');
    expect(deviceLine(workout({ device_status: 'counting', phase: 'counting', status: 'active' }))).toBe('Counting');
  });

  it('waits for the device when it has not reported or still reports the previous step', () => {
    expect(deviceLine(workout({ device_status: null }))).toBe('Waiting for the device');
    // Target reached: the device has not switched to the after reading yet.
    expect(deviceLine(workout({ device_status: 'counting', phase: 'after_bpm', status: 'active' }))).toBe('Waiting for the device');
    // Before reading skipped on the website: the device is still reading.
    expect(deviceLine(workout({ device_status: 'reading', phase: 'counting', status: 'active' }))).toBe('Waiting for the device');
  });

  it('is empty once the exercise has ended', () => {
    expect(deviceLine(workout({ device_status: 'counting', phase: 'done', status: 'completed' }))).toBe('');
  });
});

describe('device contact', () => {
  const serverTime = '2026-11-18T15:00:10.000Z';
  const seenAgo = ms => new Date(Date.parse(serverTime) - ms).toISOString();

  it('measures from the last device contact on the server clock', () => {
    expect(contactAgeMs(workout({ device_seen_at: seenAgo(3200), status: 'active' }), serverTime)).toBe(3200);
  });

  it('measures from creation when the device has not been in contact', () => {
    expect(contactAgeMs(workout({}), serverTime)).toBe(10000);
  });

  it('never returns a negative age', () => {
    expect(contactAgeMs(workout({ created_at: '2026-11-18T15:00:11.000Z' }), serverTime)).toBe(0);
  });

  it('is stale only after more than 5000 ms', () => {
    expect(STALE_AFTER_MS).toBe(5000);
    expect(isStale(workout({ device_seen_at: seenAgo(5000), status: 'active' }), serverTime)).toBe(false);
    expect(isStale(workout({ device_seen_at: seenAgo(5001), status: 'active' }), serverTime)).toBe(true);
    expect(isStale(workout({ device_seen_at: seenAgo(5001), status: 'pending' }), serverTime)).toBe(true);
  });

  it('is never stale once the exercise has ended or without a server time', () => {
    expect(isStale(workout({ device_seen_at: seenAgo(60000), status: 'completed', phase: 'done' }), serverTime)).toBe(false);
    expect(isStale(workout({ device_seen_at: seenAgo(60000), status: 'incomplete', phase: 'done' }), serverTime)).toBe(false);
    expect(isStale(workout({ status: 'active' }), null)).toBe(false);
  });
});

describe('isOpen', () => {
  it('is true only for pending and active exercises', () => {
    expect(isOpen(workout({ status: 'pending' }))).toBe(true);
    expect(isOpen(workout({ status: 'active' }))).toBe(true);
    expect(isOpen(workout({ status: 'completed' }))).toBe(false);
    expect(isOpen(workout({ status: 'incomplete' }))).toBe(false);
    expect(isOpen(workout({ status: 'cancelled' }))).toBe(false);
  });
});

describe('notRespondingText', () => {
  it('states the whole seconds since the last device contact', () => {
    const w = workout({ status: 'active', device_seen_at: '2026-11-18T15:00:02.600Z' });
    expect(notRespondingText(w, '2026-11-18T15:00:10.000Z')).toBe('Device not responding (last update 7 s ago)');
  });
});

describe('withWorkout', () => {
  const session = { id: 's1', status: 'active', workouts: [workout({ id: 'a', status: 'completed' })] };

  it('replaces an exercise with the same id', () => {
    const next = withWorkout(session, workout({ id: 'a', status: 'incomplete' }));
    expect(next.workouts.map(w => [w.id, w.status])).toEqual([['a', 'incomplete']]);
  });

  it('adds a new exercise at the end without changing the original', () => {
    const next = withWorkout(session, workout({ id: 'b' }));
    expect(next.workouts.map(w => w.id)).toEqual(['a', 'b']);
    expect(session.workouts).toHaveLength(1);
  });
});

describe('parseTargetReps', () => {
  it('accepts whole numbers from 1 to 50', () => {
    expect(parseTargetReps('1')).toEqual({ reps: 1 });
    expect(parseTargetReps(' 10 ')).toEqual({ reps: 10 });
    expect(parseTargetReps('50')).toEqual({ reps: 50 });
  });
  it('rejects anything else with a message', () => {
    for (const bad of ['', '0', '51', '-3', '2.5', 'ten', '1e1']) expect(parseTargetReps(bad).error).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';
import { formatClock, formatDurationWords, minutesToSeconds } from './format.js';
import { heartRateState, STALE_AFTER_MS } from './heartRate.js';
import { buildBuckets, filterDaily, sumRows } from './progress.js';

describe('minutesToSeconds', () => {
  it('converts minutes to whole seconds', () => {
    expect(minutesToSeconds('10')).toEqual({ seconds: 600 });
    expect(minutesToSeconds(' 2.5 ')).toEqual({ seconds: 150 });
    expect(minutesToSeconds('1440')).toEqual({ seconds: 86400 });
  });
  it('rejects values outside 1-86400 seconds or that are not numbers', () => {
    for (const bad of ['', '0', '0.001', '1441', '-5', 'ten', '1e3']) {
      expect(minutesToSeconds(bad).error).toBeTruthy();
    }
  });
});

describe('formatting', () => {
  it('formats clocks and durations', () => {
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatDurationWords(120)).toBe('2 min');
    expect(formatDurationWords(3720)).toBe('1 hr 2 min');
  });
});

describe('heartRateState', () => {
  const now = Date.parse('2026-11-16T15:00:10.000Z');
  const reading = (sequence, bpm, secondsAgo) => ({
    sequence, heart_rate_bpm: bpm, received_at: new Date(now - secondsAgo * 1000).toISOString(),
  });
  const active = { status: 'active', heart_rate_bpm: null };

  it('never turns a missing reading into a number', () => {
    const state = heartRateState({ workout: active, readings: [reading(1, null, 1)], now, disconnected: false });
    expect(state).toMatchObject({ kind: 'none', bpm: null });
  });
  it('is live within the threshold and stale after it', () => {
    expect(STALE_AFTER_MS).toBe(5000);
    expect(heartRateState({ workout: active, readings: [reading(1, 90, 5)], now, disconnected: false }).kind).toBe('live');
    expect(heartRateState({ workout: active, readings: [reading(1, 90, 5.1)], now, disconnected: false }).kind).toBe('stale');
  });
  it('judges freshness from the latest non-null reading, not newer null ones', () => {
    const readings = [reading(1, 90, 20), reading(2, null, 1)];
    expect(heartRateState({ workout: active, readings, now, disconnected: false })).toMatchObject({ kind: 'stale', bpm: 90 });
  });
  it('is stale while disconnected and final once the workout has ended', () => {
    const readings = [reading(1, 90, 1)];
    expect(heartRateState({ workout: active, readings, now, disconnected: true }).kind).toBe('stale');
    expect(heartRateState({ workout: { status: 'completed' }, readings, now, disconnected: false }).kind).toBe('final');
  });
});

describe('progress ranges', () => {
  const now = Date.parse('2026-11-17T03:00:00Z');
  const row = (date, workouts, repetitions, duration_seconds) => ({ date, exercise_name: 'Squats', workouts, repetitions, duration_seconds });
  const daily = [row('2026-07-01', 1, 10, 60), row('2026-11-10', 1, 20, 120), row('2026-11-11', 2, 30, 300), row('2026-11-17', 1, 5, 30)];

  it('keeps only rows inside the range using UTC date keys', () => {
    expect(filterDaily(daily, 7, now).map(r => r.date)).toEqual(['2026-11-11', '2026-11-17']);
    expect(sumRows(filterDaily(daily, 7, now))).toEqual({ workouts: 3, repetitions: 35, duration_seconds: 330 });
    expect(filterDaily(daily, null, now)).toHaveLength(4);
  });
  it('builds one bucket per day, or per month for long spans', () => {
    const week = buildBuckets(daily, 7, now);
    expect(week.monthly).toBe(false);
    expect(week.buckets).toHaveLength(7);
    expect(week.buckets[0]).toMatchObject({ key: '2026-11-11', workouts: 2 });
    expect(week.buckets[1]).toMatchObject({ key: '2026-11-12', workouts: 0 });
    const all = buildBuckets(daily, null, now);
    expect(all.monthly).toBe(true);
    expect(all.buckets.map(b => b.key)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(all.buckets[4]).toMatchObject({ workouts: 4, repetitions: 55 });
  });
});

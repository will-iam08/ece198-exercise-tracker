import { describe, expect, it } from 'vitest';
import { formatClock, formatDurationWords } from './format.js';
import { buildBuckets, filterDaily, sumRows } from './progress.js';

describe('formatting', () => {
  it('formats clocks and durations', () => {
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatDurationWords(120)).toBe('2 min');
    expect(formatDurationWords(3720)).toBe('1 hr 2 min');
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

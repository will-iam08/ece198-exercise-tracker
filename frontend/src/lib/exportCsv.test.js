import { describe, expect, it } from 'vitest';
import { csvFilename, downloadCsv, SESSION_CSV_COLUMNS, sessionsToRows, toCsv } from './exportCsv.js';

describe('toCsv', () => {
  const columns = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];

  it('writes a header and CRLF line endings', () => {
    expect(toCsv(columns, [{ a: 1, b: 'x' }, { a: 2, b: 'y' }])).toBe('A,B\r\n1,x\r\n2,y\r\n');
    expect(toCsv(columns, [])).toBe('A,B\r\n');
    expect(toCsv(columns, null)).toBe('A,B\r\n');
  });

  it('quotes commas, quotes and line breaks', () => {
    const csv = toCsv(columns, [{ a: 'one, two', b: 'say "hi"' }, { a: 'line\nbreak', b: 'cr\rhere' }]);
    expect(csv).toBe('A,B\r\n"one, two","say ""hi"""\r\n"line\nbreak","cr\rhere"\r\n');
    expect(toCsv([{ key: 'a', label: 'Name, full' }], [])).toBe('"Name, full"\r\n');
  });

  it('writes null and undefined as empty, keeps 0 and false', () => {
    expect(toCsv(columns, [{ a: null }, { a: 0, b: false }])).toBe('A,B\r\n,\r\n0,false\r\n');
  });

  it('accepts a function key', () => {
    expect(toCsv([{ key: row => row.a * 2, label: 'Double' }], [{ a: 4 }])).toBe('Double\r\n8\r\n');
  });

  it('guards against formulas but leaves numbers alone', () => {
    const rows = [{ a: '=SUM(A1:A2)', b: '+1' }, { a: '-2', b: '@cmd' }, { a: '\tx', b: -5 }, { a: 3.5, b: '1-2' }];
    expect(toCsv(columns, rows)).toBe("A,B\r\n'=SUM(A1:A2),'+1\r\n'-2,'@cmd\r\n'\tx,-5\r\n3.5,1-2\r\n");
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: '\r=1' }])).toBe("A\r\n\"'\r=1\"\r\n");
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: '=1,2' }])).toBe("A\r\n\"'=1,2\"\r\n");
  });

  it('writes dates as ISO text', () => {
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: new Date('2026-11-18T10:00:00Z') }])).toBe('A\r\n2026-11-18T10:00:00.000Z\r\n');
  });
});

describe('session rows', () => {
  const workout = fields => ({
    id: 'w1', exercise_name: 'Arm curl', target_reps: 10, repetitions: 10, status: 'completed', phase: 'done',
    before_bpm: 72, after_bpm: 95, before_skipped: false, after_skipped: false,
    started_at: '2026-11-18T10:01:00.000Z', ended_at: '2026-11-18T10:03:00.000Z', ...fields,
  });
  const sessions = [
    { id: 's1', status: 'ended', created_at: '2026-11-18T10:00:00.000Z', workouts: [
      workout(),
      workout({ id: 'w2', exercise_name: 'Back row', repetitions: 4, status: 'incomplete', before_bpm: null, before_skipped: true, after_bpm: null }),
    ] },
    { id: 's2', status: 'active', created_at: '2026-11-19T09:00:00Z', workouts: [] },
  ];

  it('makes one row per exercise', () => {
    const rows = sessionsToRows(sessions);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      session_at: '2026-11-18T10:00:00.000Z', session_status: 'Ended', exercise: 'Arm curl', target_reps: 10,
      repetitions: 10, before_bpm: 72, before_note: '', after_bpm: 95, after_note: '', status: 'Complete',
      started_at: '2026-11-18T10:01:00.000Z', ended_at: '2026-11-18T10:03:00.000Z',
    });
  });

  it('never turns a missing heart rate into 0', () => {
    const row = sessionsToRows(sessions)[1];
    expect(row.before_bpm).toBe(null);
    expect(row.before_note).toBe('Skipped');
    expect(row.after_bpm).toBe(null);
    expect(row.after_note).toBe('No reading');
    expect(row.status).toBe('Incomplete');
  });

  it('keeps a session without exercises as one row', () => {
    const row = sessionsToRows(sessions)[2];
    expect(row.session_at).toBe('2026-11-19T09:00:00.000Z');
    expect(row.session_status).toBe('In progress');
    expect(row.exercise).toBe(null);
    expect(row.before_bpm).toBe(null);
    expect(row.status).toBe(null);
  });

  it('handles empty input and odd values', () => {
    expect(sessionsToRows(null)).toEqual([]);
    expect(sessionsToRows([])).toEqual([]);
    const [row] = sessionsToRows([{ status: 'ended', created_at: 'not a date', workouts: [workout({ started_at: null, ended_at: undefined })] }]);
    expect(row.session_at).toBe(null);
    expect(row.started_at).toBe(null);
    expect(row.ended_at).toBe(null);
  });

  it('fills every column', () => {
    const csv = toCsv(SESSION_CSV_COLUMNS, sessionsToRows(sessions));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Session started,Session status,Exercise,Target reps,Reps done,Heart rate before (bpm),'
      + 'Heart rate before note,Heart rate after (bpm),Heart rate after note,Exercise status,Exercise started,Exercise ended');
    expect(lines[2]).toBe('2026-11-18T10:00:00.000Z,Ended,Back row,10,4,,Skipped,,No reading,Incomplete,'
      + '2026-11-18T10:01:00.000Z,2026-11-18T10:03:00.000Z');
    expect(lines[3]).toBe('2026-11-19T09:00:00.000Z,In progress,,,,,,,,,,');
    expect(lines).toHaveLength(5);
  });
});

describe('file names and download', () => {
  it('builds a safe dated file name', () => {
    const day = new Date(2026, 10, 19, 23, 30);
    expect(csvFilename('motiontrack-sessions', day)).toBe('motiontrack-sessions-2026-11-19.csv');
    expect(csvFilename('MotionTrack Sessions: José/Ana!', day)).toBe('motiontrack-sessions-jose-ana-2026-11-19.csv');
    expect(csvFilename('', day)).toBe('export-2026-11-19.csv');
    expect(csvFilename(null, new Date(2026, 0, 5))).toBe('export-2026-01-05.csv');
    expect(csvFilename('x', new Date('nope'))).toMatch(/^x-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('does nothing without a document', () => {
    expect(typeof document).toBe('undefined');
    expect(downloadCsv('a.csv', 'A\r\n')).toBe(false);
  });
});

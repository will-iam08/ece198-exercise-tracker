import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../db.js';
import { LATEST_VERSION } from '../migrations.js';

const now = '2026-01-01T00:00:00.000Z';

async function tempPath(t) {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'db.sqlite');
}

async function seedVersion1(path) {
  const sql = await readFile(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(sql);
  const user = db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  user.run('p1', 'Pat', 'pat@example.com', 'x', 'participant', now);
  user.run('s1', 'Sam', 'sam@example.com', 'x', 'staff', now);
  db.prepare('INSERT INTO devices (id, participant_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('d1', 'p1', 'Band', 'hash', now);
  const workout = db.prepare(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, target_duration_seconds,
    status, repetitions, elapsed_seconds, heart_rate_bpm, last_sequence, created_at, updated_at)
    VALUES (?, 'p1', 'd1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  workout.run('w1', 'Curl', 60, 'completed', 12, 60, 80, 3, '2026-01-01T00:00:01.000Z', now);
  workout.run('w2', 'Press', 90, 'cancelled', 4, 20, null, 1, '2026-01-01T00:00:02.000Z', now);
  workout.run('w3', 'Row', 120, 'pending', 0, 0, null, 0, '2026-01-01T00:00:03.000Z', now);
  const reading = db.prepare(`INSERT INTO workout_readings (workout_id, sequence, repetitions, elapsed_seconds,
    heart_rate_bpm, completed, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  reading.run('w1', 1, 4, 20, 70, 0, now);
  reading.run('w1', 2, 8, 40, 75, 0, now);
  reading.run('w1', 3, 12, 60, 80, 1, now);
  reading.run('w2', 1, 2, 10, null, 0, now);
  reading.run('w2', 2, 4, 20, null, 0, now);
  db.exec('PRAGMA user_version = 0;');
  const rows = db.prepare('SELECT * FROM workouts ORDER BY id').all();
  db.close();
  return rows;
}

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const version = db => db.prepare('PRAGMA user_version').get().user_version;

test('migrates a version-1 database without losing data', async t => {
  const path = await tempPath(t);
  const before = await seedVersion1(path);
  const db = createDatabase(path);
  t.after(() => db.close());

  assert.equal(version(db), 2);
  assert.equal(LATEST_VERSION, 2);
  assert.equal(count(db, 'users'), 2);
  assert.equal(count(db, 'workouts'), 3);
  assert.equal(count(db, 'workout_readings'), 5);
  const after = db.prepare('SELECT * FROM workouts ORDER BY id').all();
  for (const [i, old] of before.entries()) {
    assert.equal(after[i].kind, 'timed');
    for (const key of Object.keys(old)) assert.equal(after[i][key], old[key], `${old.id}.${key}`);
    assert.equal(after[i].session_id, null);
    assert.equal(after[i].before_skipped, 0);
    assert.equal(after[i].after_skipped, 0);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r => r.name);
  for (const name of ['idx_workouts_device_open', 'idx_workouts_participant_created', 'idx_sessions_active', 'idx_workouts_session']) {
    assert.ok(indexes.includes(name), name);
  }
});

test('fresh database lands on version 2', () => {
  const db = createDatabase(':memory:');
  try {
    assert.equal(version(db), 2);
    assert.equal(count(db, 'workouts'), 0);
    assert.equal(count(db, 'exercise_sessions'), 0);
    assert.equal(count(db, 'workout_events'), 0);
  } finally {
    db.close();
  }
});

test('reopening is a no-op', async t => {
  const path = await tempPath(t);
  await seedVersion1(path);
  createDatabase(path).close();
  const db = createDatabase(path);
  t.after(() => db.close());
  assert.equal(version(db), 2);
  assert.equal(count(db, 'workouts'), 3);
  assert.equal(count(db, 'workout_readings'), 5);
});

test('constraints', async t => {
  const path = await tempPath(t);
  await seedVersion1(path);
  const db = createDatabase(path);
  t.after(() => db.close());
  db.prepare("UPDATE workouts SET status = 'cancelled' WHERE status = 'pending'").run();
  db.prepare("INSERT INTO exercise_sessions (id, participant_id, device_id, status, created_at, updated_at) VALUES ('s1', 'p1', 'd1', 'active', ?, ?)").run(now, now);
  const insert = (id, sessionId, reps) => db.prepare(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind,
    session_id, exercise_id, target_reps, phase, status, created_at, updated_at)
    VALUES (?, 'p1', 'd1', 'Arm Curl', 'reps', ?, 'arm_curl', ?, 'before_bpm', 'pending', ?, ?)`).run(id, sessionId, reps, now, now);

  assert.throws(() => insert('r0', null, 10), /CHECK constraint/i);
  assert.throws(() => insert('r1', 's1', 51), /CHECK constraint/i);
  assert.throws(() => insert('r2', 's1', 0), /CHECK constraint/i);
  insert('r3', 's1', 50);
  assert.throws(() => db.prepare("INSERT INTO exercise_sessions (id, participant_id, device_id, status, created_at, updated_at) VALUES ('s2', 'p1', 'd1', 'active', ?, ?)").run(now, now), /UNIQUE constraint/i);
  db.prepare("UPDATE exercise_sessions SET status = 'ended', ended_at = ? WHERE id = 's1'").run(now);
  db.prepare("INSERT INTO exercise_sessions (id, participant_id, device_id, status, created_at, updated_at) VALUES ('s2', 'p1', 'd1', 'active', ?, ?)").run(now, now);
});

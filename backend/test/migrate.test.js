import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../db.js';
import { LATEST_VERSION, migrate } from '../migrations.js';

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

  assert.equal(version(db), LATEST_VERSION);
  assert.equal(LATEST_VERSION, 4);
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

test('fresh database lands on the latest version', () => {
  const db = createDatabase(':memory:');
  try {
    assert.equal(version(db), LATEST_VERSION);
    assert.equal(count(db, 'patient_plans'), 0);
    assert.equal(count(db, 'patient_messages'), 0);
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
  assert.equal(version(db), LATEST_VERSION);
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

test('workout CHECK rejects NULL required fields', async t => {
  const path = await tempPath(t);
  await seedVersion1(path);
  const db = createDatabase(path);
  t.after(() => db.close());
  db.prepare("UPDATE workouts SET status = 'cancelled' WHERE status = 'pending'").run();
  db.prepare("INSERT INTO exercise_sessions (id, participant_id, device_id, status, created_at, updated_at) VALUES ('s1', 'p1', 'd1', 'active', ?, ?)").run(now, now);
  const reps = (exerciseId, targetReps, phase) => db.prepare(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind,
    session_id, exercise_id, target_reps, phase, status, created_at, updated_at)
    VALUES ('n1', 'p1', 'd1', 'Arm Curl', 'reps', 's1', ?, ?, ?, 'pending', ?, ?)`).run(exerciseId, targetReps, phase, now, now);
  assert.throws(() => reps('arm_curl', null, 'before_bpm'), /CHECK constraint/i);
  assert.throws(() => reps(null, 10, 'before_bpm'), /CHECK constraint/i);
  assert.throws(() => reps('arm_curl', 10, null), /CHECK constraint/i);
  assert.throws(() => db.prepare(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind,
    target_duration_seconds, status, created_at, updated_at)
    VALUES ('n2', 'p1', 'd1', 'Curl', 'timed', NULL, 'pending', ?, ?)`).run(now, now), /CHECK constraint/i);
  reps('arm_curl', 10, 'before_bpm');
});

// A database left at version 2 (sessions and rep exercises, no admin role).
async function seedVersion2(path) {
  await seedVersion1(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db, 2);
  assert.equal(version(db), 2);
  db.prepare("INSERT INTO staff_participants (staff_id, participant_id) VALUES ('s1', 'p1')").run();
  db.prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES ('t1', 'p1', ?, '2999-01-01T00:00:00.000Z')").run(now);
  db.prepare("UPDATE workouts SET status = 'cancelled' WHERE status = 'pending'").run();
  db.prepare("INSERT INTO exercise_sessions (id, participant_id, device_id, status, created_at, updated_at) VALUES ('es1', 'p1', 'd1', 'ended', ?, ?)").run(now, now);
  db.prepare(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind, session_id, exercise_id, target_reps, phase,
    status, repetitions, before_bpm, after_bpm, created_at, updated_at)
    VALUES ('r1', 'p1', 'd1', 'Arm Curl', 'reps', 'es1', 'arm_curl', 10, 'done', 'completed', 10, 72, 96, ?, ?)`).run(now, now);
  db.prepare("INSERT INTO workout_events (workout_id, sequence, type, bpm, received_at) VALUES ('r1', 1, 'before_bpm', 72, ?)").run(now);
  db.close();
}

test('version 3 upgrades a version-2 database, keeps every row and adds the admin role', async t => {
  const path = await tempPath(t);
  await seedVersion2(path);
  const db = createDatabase(path);
  t.after(() => db.close());

  assert.equal(version(db), LATEST_VERSION);
  assert.deepEqual(db.prepare('SELECT id, role FROM users ORDER BY id').all().map(row => ({ ...row })),
    [{ id: 'p1', role: 'participant' }, { id: 's1', role: 'staff' }]);
  assert.equal(count(db, 'staff_participants'), 1);
  assert.equal(count(db, 'auth_sessions'), 1);
  assert.equal(count(db, 'devices'), 1);
  assert.equal(count(db, 'exercise_sessions'), 1);
  assert.equal(count(db, 'workouts'), 4);
  assert.equal(count(db, 'workout_readings'), 5);
  assert.equal(count(db, 'workout_events'), 1);
  assert.equal(db.prepare("SELECT after_bpm FROM workouts WHERE id = 'r1'").get().after_bpm, 96);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r => r.name);
  for (const name of ['idx_workouts_device_open', 'idx_sessions_active', 'idx_staff_participants_participant',
    'idx_auth_sessions_user', 'idx_patient_messages_participant']) {
    assert.ok(indexes.includes(name), name);
  }

  const user = db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  user.run('a1', 'Ada', 'ada@example.com', 'x', 'admin', now);
  assert.throws(() => user.run('x1', 'X', 'x@example.com', 'x', 'owner', now), /CHECK constraint/i);
  assert.throws(() => user.run('x2', 'X', 'PAT@example.com', 'x', 'participant', now), /UNIQUE constraint/i);
  // Foreign keys from the other tables still point at the rebuilt users table.
  assert.throws(() => db.prepare("INSERT INTO devices (id, participant_id, name, token_hash, created_at) VALUES ('d2', 'nobody', 'X', 'h2', ?)").run(now), /FOREIGN KEY/i);
  db.prepare("DELETE FROM users WHERE id = 's1'").run();
  assert.equal(count(db, 'staff_participants'), 0);
  db.prepare("DELETE FROM users WHERE id = 'p1'").run();
  assert.equal(count(db, 'auth_sessions'), 0);
  assert.equal(count(db, 'workouts'), 0);
  assert.equal(count(db, 'workout_events'), 0);
});

test('care plan and message constraints', () => {
  const db = createDatabase(':memory:');
  try {
    const user = db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    user.run('p1', 'Pat', 'pat@example.com', 'x', 'participant', now);
    user.run('s1', 'Sam', 'sam@example.com', 'x', 'staff', now);
    const plan = (values) => {
      const row = { notes: '', arm: null, min: null, max: null, ...values };
      db.prepare(`INSERT OR REPLACE INTO patient_plans (participant_id, staff_id, notes, arm_curl_reps, target_bpm_min, target_bpm_max, updated_at)
        VALUES ('p1', 's1', ?, ?, ?, ?, ?)`).run(row.notes, row.arm, row.min, row.max, now);
    };
    plan({ arm: 12, min: 60, max: 120 });
    plan({ min: 30, max: 220 });
    plan({ arm: 50 });
    assert.throws(() => plan({ arm: 0 }), /CHECK constraint/i);
    assert.throws(() => plan({ arm: 51 }), /CHECK constraint/i);
    assert.throws(() => plan({ min: 29 }), /CHECK constraint/i);
    assert.throws(() => plan({ max: 221 }), /CHECK constraint/i);
    assert.throws(() => plan({ min: 120, max: 100 }), /CHECK constraint/i);
    assert.throws(() => plan({ notes: 'x'.repeat(1001) }), /CHECK constraint/i);
    db.prepare("DELETE FROM users WHERE id = 's1'").run();
    assert.equal(db.prepare("SELECT staff_id FROM patient_plans WHERE participant_id = 'p1'").get().staff_id, null);

    const message = (values) => {
      const row = { subject: 'Hi', body: 'Question', source: 'email_bot', reply: null, ...values };
      db.prepare(`INSERT INTO patient_messages (id, participant_id, sender_email, subject, body, source, doctor_reply, received_at)
        VALUES (?, 'p1', 'pat@example.com', ?, ?, ?, ?, ?)`).run(String(Math.random()), row.subject, row.body, row.source, row.reply, now);
    };
    message({});
    message({ source: 'portal', body: 'x'.repeat(4000), reply: 'y'.repeat(4000) });
    assert.throws(() => message({ body: '   ' }), /CHECK constraint/i);
    assert.throws(() => message({ body: 'x'.repeat(4001) }), /CHECK constraint/i);
    assert.throws(() => message({ subject: 'x'.repeat(201) }), /CHECK constraint/i);
    assert.throws(() => message({ source: 'sms' }), /CHECK constraint/i);
    assert.throws(() => message({ reply: 'y'.repeat(4001) }), /CHECK constraint/i);
    db.prepare("DELETE FROM users WHERE id = 'p1'").run();
    assert.equal(count(db, 'patient_messages'), 0);
    assert.equal(count(db, 'patient_plans'), 0);
  } finally {
    db.close();
  }
});

test('version 4 upgrades a version-3 database, keeps every row and supports app sets without devices', async t => {
  const path = await tempPath(t);
  await seedVersion2(path);
  const v3 = new DatabaseSync(path);
  v3.exec('PRAGMA foreign_keys = ON;');
  migrate(v3, 3);
  assert.equal(version(v3), 3);
  v3.prepare(`INSERT INTO patient_plans (participant_id, staff_id, notes, arm_curl_reps, updated_at)
    VALUES ('p1', 's1', 'Keep steady', 10, ?)`).run(now);
  v3.close();

  const db = createDatabase(path);
  t.after(() => db.close());

  assert.equal(version(db), 4);
  assert.equal(count(db, 'exercise_sessions'), 1);
  assert.equal(count(db, 'workouts'), 4);
  assert.equal(count(db, 'workout_readings'), 5);
  assert.equal(count(db, 'workout_events'), 1);
  assert.equal(count(db, 'patient_plans'), 1);
  assert.equal(db.prepare("SELECT source, device_id FROM exercise_sessions WHERE id = 'es1'").get().source, 'device');
  assert.equal(db.prepare("SELECT source, client_id FROM workouts WHERE id = 'r1'").get().source, 'device');
  assert.equal(db.prepare("SELECT source, client_id FROM workouts WHERE id = 'r1'").get().client_id, null);

  // App sessions and workouts need no device row, while device rows still require a valid device_id.
  db.prepare("INSERT INTO exercise_sessions (id, participant_id, device_id, source, status, created_at, ended_at, updated_at) VALUES ('app-s1', 'p1', NULL, 'app', 'ended', ?, ?, ?)")
    .run(now, now, now);
  db.prepare(`INSERT INTO workouts (id, participant_id, device_id, source, client_id, exercise_name, kind, session_id, exercise_id,
    target_reps, phase, status, repetitions, elapsed_seconds, created_at, updated_at)
    VALUES ('app-w1', 'p1', NULL, 'app', 'uuid-1', 'Arm Curl', 'reps', 'app-s1', 'arm_curl', 10, 'done', 'completed', 10, 25, ?, ?)`)
    .run(now, now);
  assert.throws(() => db.prepare(`INSERT INTO workouts (id, participant_id, device_id, source, client_id, exercise_name, kind, session_id, exercise_id,
    target_reps, phase, status, repetitions, elapsed_seconds, created_at, updated_at)
    VALUES ('app-w2', 'p1', NULL, 'app', 'uuid-1', 'Arm Curl', 'reps', 'app-s1', 'arm_curl', 10, 'done', 'completed', 10, 25, ?, ?)`)
    .run(now, now), /UNIQUE constraint/i);
  assert.throws(() => db.prepare(`INSERT INTO exercise_sessions (id, participant_id, device_id, source, status, created_at, updated_at)
    VALUES ('bad-s', 'p1', NULL, 'device', 'ended', ?, ?)`).run(now, now), /CHECK constraint/i);
  assert.throws(() => db.prepare(`INSERT INTO workouts (id, participant_id, device_id, source, client_id, exercise_name, kind, session_id, exercise_id,
    target_reps, phase, status, created_at, updated_at)
    VALUES ('bad-d', 'p1', 'missing-device', 'app', NULL, 'Arm Curl', 'reps', 'app-s1', 'arm_curl', 10, 'done', 'completed', ?, ?)`)
    .run(now, now), /FOREIGN KEY constraint/i);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);

  db.prepare("DELETE FROM users WHERE id = 'p1'").run();
  assert.equal(count(db, 'exercise_sessions'), 0);
  assert.equal(count(db, 'workouts'), 0);
  assert.equal(count(db, 'workout_events'), 0);
});

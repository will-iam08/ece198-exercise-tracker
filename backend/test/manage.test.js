import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDatabase } from '../db.js';
import { runManage } from '../manage.js';
import { hashPassword, verifyPassword } from '../security.js';

const now = '2026-11-16T12:00:00.000Z';
const password = 'local-test-password';

function addParticipant(db, id) {
  db.prepare('INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, id, `${id}@example.com`, 'unused-in-storage-tests', 'participant', now);
}

test('password hashes use independent salts and verify without exposing passwords', async () => {
  const encoded = await hashPassword(password);
  assert.notEqual(encoded, await hashPassword(password));
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('incorrect-password', encoded), false);
  assert.equal(await verifyPassword(password, 'malformed'), false);
});

test('staff management rejects weak passwords, duplicates, promotions, and invalid assignment roles', async (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  await assert.rejects(
    runManage(['create-staff', 'staff@example.com', 'Test staff'], { db, password: 'short' }),
    /STAFF_PASSWORD/
  );
  const { user: staff } = await runManage(['create-staff', 'STAFF@example.com', 'Test staff'], { db, password });
  assert.equal(staff.email, 'staff@example.com');
  assert.equal(staff.role, 'staff');
  assert.equal(Object.hasOwn(staff, 'password_hash'), false);
  await assert.rejects(
    runManage(['create-staff', staff.email, 'Another staff'], { db, password }), /already exists/
  );
  addParticipant(db, 'participant');
  await assert.rejects(
    runManage(['create-staff', 'participant@example.com', 'Promoted participant'], { db, password }), /already exists/
  );
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get('participant').role, 'participant');
  await assert.rejects(runManage(['assign', 'participant@example.com', staff.email], { db }), /staff account/);
  await assert.rejects(runManage(['assign', staff.email, staff.email], { db }), /participant account/);
  await runManage(['assign', staff.email, 'participant@example.com'], { db });
  await runManage(['assign', staff.email, 'participant@example.com'], { db });
  assert.equal(db.prepare('SELECT count(*) AS n FROM staff_participants').get().n, 1);
  await runManage(['unassign', staff.email, 'participant@example.com'], { db });
  assert.equal(db.prepare('SELECT count(*) AS n FROM staff_participants').get().n, 0);
});

test('database enforces device ownership and permits only one unfinished workout per device', (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  addParticipant(db, 'participant');
  addParticipant(db, 'other');
  db.prepare('INSERT INTO devices (id,participant_id,name,token_hash,created_at) VALUES (?,?,?,?,?)')
    .run('device', 'participant', 'Test device', 'test-token-hash', now);
  const insert = db.prepare(`INSERT INTO workouts
    (id,participant_id,device_id,exercise_name,target_duration_seconds,status,created_at,updated_at)
    VALUES (?,?,'device','Bicep curls',120,?,?,?)`);
  insert.run('first', 'participant', 'pending', now, now);
  assert.throws(() => insert.run('second', 'participant', 'active', now, now), /UNIQUE/);
  assert.throws(() => insert.run('wrong-owner', 'other', 'completed', now, now), /FOREIGN KEY/);
  insert.run('history', 'participant', 'completed', now, now);
  db.prepare("UPDATE workouts SET status = 'cancelled' WHERE id = 'first'").run();
  insert.run('next', 'participant', 'pending', now, now);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('file database persists data and can initialize the same schema again', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ece198-storage-test-'));
  const filename = join(directory, 'nested', 'test.sqlite');
  let db = createDatabase(filename);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  addParticipant(db, 'persisted');
  db.close();
  db = createDatabase(filename);
  assert.equal(db.prepare('SELECT email FROM users WHERE id = ?').get('persisted').email, 'persisted@example.com');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

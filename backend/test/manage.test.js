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

async function addParticipant(db, id) {
  await db.run('INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)',
    id, id, `${id}@example.com`, 'unused-in-storage-tests', 'participant', now);
}

test('password hashes use independent salts and verify without exposing passwords', async () => {
  const encoded = await hashPassword(password);
  assert.notEqual(encoded, await hashPassword(password));
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('incorrect-password', encoded), false);
  assert.equal(await verifyPassword(password, 'malformed'), false);
});

test('staff management rejects weak passwords, duplicates, promotions, and invalid assignment roles', async (t) => {
  const db = await createDatabase(':memory:');
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
  await addParticipant(db, 'participant');
  await assert.rejects(
    runManage(['create-staff', 'participant@example.com', 'Promoted participant'], { db, password }), /already exists/
  );
  assert.equal((await db.get('SELECT role FROM users WHERE id = ?', 'participant')).role, 'participant');
  await assert.rejects(runManage(['assign', 'participant@example.com', staff.email], { db }), /staff account/);
  await assert.rejects(runManage(['assign', staff.email, staff.email], { db }), /participant account/);
  await runManage(['assign', staff.email, 'participant@example.com'], { db });
  await runManage(['assign', staff.email, 'participant@example.com'], { db });
  assert.equal((await db.get('SELECT count(*) AS n FROM staff_participants')).n, 1);
  await runManage(['unassign', staff.email, 'participant@example.com'], { db });
  assert.equal((await db.get('SELECT count(*) AS n FROM staff_participants')).n, 0);
});

test('database enforces device ownership and permits only one unfinished workout per device', async (t) => {
  const db = await createDatabase(':memory:');
  t.after(() => db.close());
  await addParticipant(db, 'participant');
  await addParticipant(db, 'other');
  await db.run('INSERT INTO devices (id,participant_id,name,token_hash,created_at) VALUES (?,?,?,?,?)',
    'device', 'participant', 'Test device', 'test-token-hash', now);
  const insert = (id, participantId, status) => db.run(`INSERT INTO workouts
    (id,participant_id,device_id,exercise_name,target_duration_seconds,status,created_at,updated_at)
    VALUES (?,?,'device','Bicep curls',120,?,?,?)`, id, participantId, status, now, now);
  await insert('first', 'participant', 'pending');
  await assert.rejects(insert('second', 'participant', 'active'), /UNIQUE/);
  await assert.rejects(insert('wrong-owner', 'other', 'completed'), /FOREIGN KEY/);
  await insert('history', 'participant', 'completed');
  await db.run("UPDATE workouts SET status = 'cancelled' WHERE id = 'first'");
  await insert('next', 'participant', 'pending');
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
});

test('file database persists data and can initialize the same schema again', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ece198-storage-test-'));
  const filename = join(directory, 'nested', 'test.sqlite');
  let db = await createDatabase(filename);
  t.after(async () => {
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await addParticipant(db, 'persisted');
  await db.close();
  db = await createDatabase(filename);
  assert.equal((await db.get('SELECT email FROM users WHERE id = ?', 'persisted')).email, 'persisted@example.com');
  assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
});

test('create-admin uses ADMIN_PASSWORD, falls back to STAFF_PASSWORD, and keeps staff commands working', async (t) => {
  const db = await createDatabase(':memory:');
  t.after(() => db.close());
  await assert.rejects(
    runManage(['create-admin', 'admin@example.com', 'Site admin'], { db, password: undefined, adminPassword: 'short' }),
    /ADMIN_PASSWORD/
  );
  const { user: admin } = await runManage(['create-admin', 'ADMIN@example.com', 'Site admin'],
    { db, password: 'unused-staff-password', adminPassword: password });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.email, 'admin@example.com');
  const stored = (await db.get('SELECT password_hash FROM users WHERE id = ?', admin.id)).password_hash;
  assert.equal(await verifyPassword(password, stored), true);
  const { user: fallback } = await runManage(['create-admin', 'second@example.com', 'Second admin'],
    { db, password, adminPassword: undefined });
  assert.equal(fallback.role, 'admin');
  await assert.rejects(runManage(['create-admin', admin.email, 'Again'], { db, password }), /already exists/);
  await assert.rejects(runManage(['assign', admin.email, admin.email], { db }), /staff account/);
  const { user: staff } = await runManage(['create-staff', 'doc@example.com', 'Doctor'], { db, password });
  assert.equal(staff.role, 'staff');
  await assert.rejects(runManage(['create-boss', 'x@example.com', 'X'], { db, password }), /create-admin/);
});

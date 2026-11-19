import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../db.js';
import { seedDemo } from '../seed-demo.js';
import { verifyPassword } from '../security.js';

const backendDir = fileURLToPath(new URL('..', import.meta.url));

const valid = {
  DEMO_ADMIN_PASSWORD: 'seed-test-admin-value',
  DEMO_DOCTOR_PASSWORD: 'seed-test-doctor-value',
  DEMO_PATIENT_PASSWORD: 'seed-test-patient-value',
};

// The defaults an earlier version used, assembled here so the values never
// appear as one string in the repository.
const published = role => ['motiontrack', role, '2026'].join('-');

function setup(t) {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const lines = [];
  return { db, lines, log: line => lines.push(String(line)) };
}

const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

function assertNoSecrets(output, env) {
  for (const value of Object.values(env)) {
    if (value) assert.equal(output.includes(value), false, 'log output must not contain a password');
  }
}

async function assertRefused(t, env, pattern) {
  const { db, lines, log } = setup(t);
  const result = await seedDemo({ db, env, log });
  assert.deepEqual(result, { seeded: false, usersCreated: 0, assignmentsCreated: 0 });
  assert.equal(count(db, 'users'), 0);
  assert.equal(count(db, 'staff_participants'), 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Demo accounts not created: /);
  assert.match(lines[0], pattern);
  assertNoSecrets(lines.join('\n'), env);
}

test('demo seed creates nothing and explains what to set when no passwords are configured', async (t) => {
  const { db, lines, log } = setup(t);
  const result = await seedDemo({ db, env: { DEMO_ADMIN_PASSWORD: '' }, log });
  assert.equal(result.seeded, false);
  assert.equal(count(db, 'users'), 0);
  assert.deepEqual(lines, [
    'Demo accounts not created: set DEMO_ADMIN_PASSWORD, DEMO_DOCTOR_PASSWORD and DEMO_PATIENT_PASSWORD '
      + '(12-128 characters each)',
  ]);
});

test('demo seed creates the accounts and assignments with passwords that verify', async (t) => {
  const { db, lines, log } = setup(t);
  const result = await seedDemo({ db, env: valid, log });
  assert.deepEqual(result, { seeded: true, usersCreated: 8, assignmentsCreated: 2 });
  const users = db.prepare('SELECT email, role, password_hash FROM users').all();
  assert.equal(users.length, 8);
  assert.deepEqual(
    Object.fromEntries(['admin', 'staff', 'participant'].map(role => [role, users.filter(u => u.role === role).length])),
    { admin: 4, staff: 2, participant: 2 }
  );
  const expected = {
    admin: valid.DEMO_ADMIN_PASSWORD, staff: valid.DEMO_DOCTOR_PASSWORD, participant: valid.DEMO_PATIENT_PASSWORD,
  };
  for (const user of users) {
    assert.equal(await verifyPassword(expected[user.role], user.password_hash), true, user.email);
    for (const [role, other] of Object.entries(expected)) {
      if (role !== user.role) assert.equal(await verifyPassword(other, user.password_hash), false, user.email);
    }
  }
  const pairs = db.prepare(`SELECT s.email AS staff, p.email AS participant FROM staff_participants sp
    JOIN users s ON s.id = sp.staff_id JOIN users p ON p.id = sp.participant_id ORDER BY s.email`).all();
  assert.deepEqual(pairs.map(row => [row.staff, row.participant]), [
    ['dr.chen@motiontrack.org', 'maya.patel@motiontrack.org'],
    ['dr.morgan@motiontrack.org', 'liam.park@motiontrack.org'],
  ]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /8 created, 0 already existed; 2 new/);
  assertNoSecrets(lines.join('\n'), valid);
});

test('demo seed refuses passwords that are too short or too long', async (t) => {
  await assertRefused(t, { ...valid, DEMO_DOCTOR_PASSWORD: 'short-pass' }, /DEMO_DOCTOR_PASSWORD must contain 12-128/);
  await assertRefused(t, { ...valid, DEMO_ADMIN_PASSWORD: 'x'.repeat(129) }, /DEMO_ADMIN_PASSWORD must contain 12-128/);
});

test('demo seed refuses the previously published default passwords', async (t) => {
  await assertRefused(t, { ...valid, DEMO_ADMIN_PASSWORD: published('admin') }, /DEMO_ADMIN_PASSWORD is a published/);
  await assertRefused(t, { ...valid, DEMO_DOCTOR_PASSWORD: published('doctor') }, /DEMO_DOCTOR_PASSWORD is a published/);
  await assertRefused(t, { ...valid, DEMO_PATIENT_PASSWORD: published('patient') }, /DEMO_PATIENT_PASSWORD is a published/);
  await assertRefused(t, { ...valid, DEMO_PATIENT_PASSWORD: ` ${published('admin').toUpperCase()} ` },
    /DEMO_PATIENT_PASSWORD is a published/);
});

test('demo seed refuses a password reused across roles and a partial configuration', async (t) => {
  await assertRefused(t, { ...valid, DEMO_PATIENT_PASSWORD: valid.DEMO_ADMIN_PASSWORD },
    /DEMO_PATIENT_PASSWORD must differ from DEMO_ADMIN_PASSWORD/);
  await assertRefused(t, { ...valid, DEMO_DOCTOR_PASSWORD: valid.DEMO_ADMIN_PASSWORD },
    /DEMO_DOCTOR_PASSWORD must differ from DEMO_ADMIN_PASSWORD/);
  await assertRefused(t, { ...valid, DEMO_PATIENT_PASSWORD: undefined }, /DEMO_PATIENT_PASSWORD is not set/);
});

test('re-running the demo seed adds nothing and keeps existing password hashes', async (t) => {
  const { db, lines, log } = setup(t);
  await seedDemo({ db, env: valid, log });
  const before = db.prepare('SELECT id, email, password_hash FROM users ORDER BY email').all();
  const changed = {
    DEMO_ADMIN_PASSWORD: 'another-admin-value', DEMO_DOCTOR_PASSWORD: 'another-doctor-value',
    DEMO_PATIENT_PASSWORD: 'another-patient-value',
  };
  const result = await seedDemo({ db, env: changed, log });
  assert.deepEqual(result, { seeded: true, usersCreated: 0, assignmentsCreated: 0 });
  assert.deepEqual(db.prepare('SELECT id, email, password_hash FROM users ORDER BY email').all(), before);
  assert.equal(count(db, 'staff_participants'), 2);
  assert.match(lines[1], /0 created, 8 already existed; 0 new/);
  assertNoSecrets(lines.join('\n'), { ...valid, ...changed });
});

test('the seed command exits 0 so the server still starts, and prints no password', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'motiontrack-seed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = extra => spawnSync(process.execPath, ['seed-demo.js'], {
    cwd: backendDir, encoding: 'utf8',
    env: { PATH: process.env.PATH, DATABASE_PATH: join(dir, 'seed.sqlite'), ...extra },
  });
  const users = () => {
    const db = createDatabase(join(dir, 'seed.sqlite'));
    try { return count(db, 'users'); } finally { db.close(); }
  };

  const unset = run({});
  assert.equal(unset.status, 0, unset.stderr);
  assert.match(unset.stdout, /^Demo accounts not created: set DEMO_ADMIN_PASSWORD/);
  assert.equal(users(), 0);

  const invalid = { ...valid, DEMO_ADMIN_PASSWORD: published('admin') };
  const refused = run(invalid);
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout, /DEMO_ADMIN_PASSWORD is a published default password/);
  assertNoSecrets(refused.stdout + refused.stderr, invalid);
  assert.equal(users(), 0);

  const seeded = run(valid);
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /Demo accounts ready: 8 created/);
  assertNoSecrets(seeded.stdout + seeded.stderr, valid);
  assert.equal(users(), 8);
});

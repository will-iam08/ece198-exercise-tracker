import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase } from './db.js';
import { hashPassword } from './security.js';

const ACCOUNTS = [
  { email: 'admin1@motiontrack.org', name: 'MotionTrack Lead Admin', role: 'admin' },
  { email: 'admin2@motiontrack.org', name: 'MotionTrack Clinical Admin', role: 'admin' },
  { email: 'admin3@motiontrack.org', name: 'MotionTrack Operations Admin', role: 'admin' },
  { email: 'admin4@motiontrack.org', name: 'MotionTrack Support Admin', role: 'admin' },
  { email: 'dr.chen@motiontrack.org', name: 'Dr Avery Chen', role: 'staff' },
  { email: 'dr.morgan@motiontrack.org', name: 'Dr Sam Morgan', role: 'staff' },
  { email: 'maya.patel@motiontrack.org', name: 'Maya Patel', role: 'participant' },
  { email: 'liam.park@motiontrack.org', name: 'Liam Park', role: 'participant' },
];

const ASSIGNMENTS = [
  ['dr.chen@motiontrack.org', 'maya.patel@motiontrack.org'],
  ['dr.morgan@motiontrack.org', 'liam.park@motiontrack.org'],
];

// One password per role, read from these environment variables.
export const PASSWORD_VARIABLES = {
  admin: 'DEMO_ADMIN_PASSWORD',
  staff: 'DEMO_DOCTOR_PASSWORD',
  participant: 'DEMO_PATIENT_PASSWORD',
};

// SHA-256 of the default passwords an earlier version of this script used. They
// were published in this public repository, so they are refused even when set
// explicitly. Only digests are kept so the old values do not appear in the code.
const PUBLISHED_PASSWORD_DIGESTS = new Set([
  '7eb59c7c6f8a21191943025b76d86cdd34701377ec3629d42e97bb1a81be92f3',
  '95bb66f591a98e206c3d6d3d93cf0980ef65632313c416409cabf01e9ddef15f',
  'a5429f8098ba91f482c3ac7c928978436018fb08210c52f4267c870a43d43dc7',
]);

function isPublished(value) {
  const digest = createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  return PUBLISHED_PASSWORD_DIGESTS.has(digest);
}

// Returns { passwords } when all three variables are usable, otherwise
// { problem } with one line naming the variables to fix. Never includes a value.
export function demoPasswords(env) {
  const roles = Object.keys(PASSWORD_VARIABLES);
  const names = Object.values(PASSWORD_VARIABLES);
  if (roles.every(role => !env[PASSWORD_VARIABLES[role]])) {
    return {
      problem: `Demo accounts not created: set ${names[0]}, ${names[1]} and ${names[2]} (12-128 characters each)`,
    };
  }
  const problems = [];
  const seen = [];
  for (const role of roles) {
    const name = PASSWORD_VARIABLES[role];
    const value = env[name];
    if (!value) {
      problems.push(`${name} is not set`);
    } else if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
      problems.push(`${name} must contain 12-128 characters`);
    } else if (isPublished(value)) {
      problems.push(`${name} is a published default password and cannot be used`);
    } else {
      const reused = seen.find(other => other.value === value);
      if (reused) problems.push(`${name} must differ from ${reused.name}`);
      seen.push({ name, value });
    }
  }
  if (problems.length > 0) return { problem: `Demo accounts not created: ${problems.join('; ')}` };
  return { passwords: Object.fromEntries(roles.map(role => [role, env[PASSWORD_VARIABLES[role]]])) };
}

// Creates the demo accounts and assignments that do not exist yet. Existing
// accounts, including their passwords, are left unchanged. Missing or invalid
// configuration is not an error: nothing is created and one line is logged.
export async function seedDemo({ db, env = process.env, log = console.log }) {
  const { passwords, problem } = demoPasswords(env);
  if (problem) {
    log(problem);
    return { seeded: false, usersCreated: 0, assignmentsCreated: 0 };
  }
  const hashes = {};
  for (const [role, value] of Object.entries(passwords)) hashes[role] = await hashPassword(value);

  const now = new Date().toISOString();
  const insertUser = db.prepare(
    'INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING'
  );
  const findUser = db.prepare('SELECT id, role FROM users WHERE email = ?');
  const insertAssignment = db.prepare(
    'INSERT INTO staff_participants (staff_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
  );

  let usersCreated = 0;
  let assignmentsCreated = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const account of ACCOUNTS) {
      usersCreated += Number(
        insertUser.run(randomUUID(), account.name, account.email, hashes[account.role], account.role, now).changes
      );
    }
    for (const [staffEmail, participantEmail] of ASSIGNMENTS) {
      const staff = findUser.get(staffEmail);
      const participant = findUser.get(participantEmail);
      if (staff?.role === 'staff' && participant?.role === 'participant') {
        assignmentsCreated += Number(insertAssignment.run(staff.id, participant.id).changes);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  log(`Demo accounts ready: ${usersCreated} created, ${ACCOUNTS.length - usersCreated} already existed; `
    + `${assignmentsCreated} new doctor-patient assignments`);
  return { seeded: true, usersCreated, assignmentsCreated };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const db = createDatabase();
  try {
    await seedDemo({ db });
  } finally {
    db.close();
  }
}

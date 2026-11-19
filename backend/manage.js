import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase } from './db.js';
import { hashPassword, publicUser } from './security.js';

function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new Error('Provide a valid email address (at most 254 characters).');
  }
  return value.trim().toLowerCase();
}

const USAGE = 'Usage: create-staff EMAIL NAME | create-admin EMAIL NAME | '
  + 'assign STAFF_EMAIL PARTICIPANT_EMAIL | unassign STAFF_EMAIL PARTICIPANT_EMAIL';

// create-staff reads STAFF_PASSWORD; create-admin reads ADMIN_PASSWORD and
// falls back to STAFF_PASSWORD.
export async function runManage(args, {
  db, password = process.env.STAFF_PASSWORD, adminPassword = process.env.ADMIN_PASSWORD,
}) {
  const [command, first, second] = args;
  if (args.length !== 3 || !['create-staff', 'create-admin', 'assign', 'unassign'].includes(command)) {
    throw new Error(USAGE);
  }
  const firstEmail = email(first);
  if (command === 'create-staff' || command === 'create-admin') {
    const admin = command === 'create-admin';
    const name = second.trim();
    if (name.length < 1 || name.length > 80) throw new Error('Name must contain 1 to 80 characters.');
    if (await db.get('SELECT id FROM users WHERE email = ?', firstEmail)) {
      throw new Error('An account with this email already exists; this command cannot change its role.');
    }
    const chosen = admin ? (adminPassword || password) : password;
    if (typeof chosen !== 'string' || chosen.length < 12 || chosen.length > 128) {
      throw new Error(admin
        ? 'Set ADMIN_PASSWORD (or STAFF_PASSWORD) to a password containing 12 to 128 characters.'
        : 'Set STAFF_PASSWORD to a password containing 12 to 128 characters.');
    }
    const user = {
      id: randomUUID(), name, email: firstEmail, role: admin ? 'admin' : 'staff', created_at: new Date().toISOString()
    };
    const passwordHash = await hashPassword(chosen);
    await db.run('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      user.id, user.name, user.email, passwordHash, user.role, user.created_at);
    return { user: publicUser(user) };
  }
  const participantEmail = email(second);
  const staff = await db.get('SELECT id, role FROM users WHERE email = ?', firstEmail);
  const participant = await db.get('SELECT id, role FROM users WHERE email = ?', participantEmail);
  if (!staff || staff.role !== 'staff') throw new Error('The staff email must belong to an existing staff account.');
  if (!participant || participant.role !== 'participant') {
    throw new Error('The participant email must belong to an existing participant account.');
  }
  if (command === 'assign') {
    await db.run('INSERT INTO staff_participants (staff_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      staff.id, participant.id);
  } else {
    await db.run('DELETE FROM staff_participants WHERE staff_id = ? AND participant_id = ?',
      staff.id, participant.id);
  }
  return { staff_id: staff.id, participant_id: participant.id, assigned: command === 'assign' };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let db;
  try {
    db = await createDatabase();
    console.log(JSON.stringify(await runManage(process.argv.slice(2), { db }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}

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

export async function runManage(args, { db, password = process.env.STAFF_PASSWORD }) {
  const [command, first, second] = args;
  if (args.length !== 3 || !['create-staff', 'assign', 'unassign'].includes(command)) {
    throw new Error('Usage: create-staff EMAIL NAME | assign STAFF_EMAIL PARTICIPANT_EMAIL | unassign STAFF_EMAIL PARTICIPANT_EMAIL');
  }
  const firstEmail = email(first);
  if (command === 'create-staff') {
    const name = second.trim();
    if (name.length < 1 || name.length > 80) throw new Error('Name must contain 1 to 80 characters.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(firstEmail)) {
      throw new Error('An account with this email already exists; this command cannot change its role.');
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new Error('Set STAFF_PASSWORD to a password containing 12 to 128 characters.');
    }
    const user = {
      id: randomUUID(), name, email: firstEmail, role: 'staff', created_at: new Date().toISOString()
    };
    const passwordHash = await hashPassword(password);
    db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.name, user.email, passwordHash, user.role, user.created_at);
    return { user: publicUser(user) };
  }
  const participantEmail = email(second);
  const staff = db.prepare('SELECT id, role FROM users WHERE email = ?').get(firstEmail);
  const participant = db.prepare('SELECT id, role FROM users WHERE email = ?').get(participantEmail);
  if (!staff || staff.role !== 'staff') throw new Error('The staff email must belong to an existing staff account.');
  if (!participant || participant.role !== 'participant') {
    throw new Error('The participant email must belong to an existing participant account.');
  }
  if (command === 'assign') {
    db.prepare('INSERT INTO staff_participants (staff_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(staff.id, participant.id);
  } else {
    db.prepare('DELETE FROM staff_participants WHERE staff_id = ? AND participant_id = ?')
      .run(staff.id, participant.id);
  }
  return { staff_id: staff.id, participant_id: participant.id, assigned: command === 'assign' };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let db;
  try {
    db = createDatabase();
    console.log(JSON.stringify(await runManage(process.argv.slice(2), { db }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

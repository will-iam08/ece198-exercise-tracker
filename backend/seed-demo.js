import { randomUUID } from 'node:crypto';
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

async function seed() {
  const db = createDatabase();
  try {
    const hashes = {
      admin: await hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'motiontrack-admin-2026'),
      staff: await hashPassword(process.env.DEMO_DOCTOR_PASSWORD || 'motiontrack-doctor-2026'),
      participant: await hashPassword(process.env.DEMO_PATIENT_PASSWORD || 'motiontrack-patient-2026'),
    };
    const now = new Date().toISOString();
    const insertUser = db.prepare(
      'INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING'
    );
    const findUser = db.prepare('SELECT id, role FROM users WHERE email = ?');
    const insertAssignment = db.prepare(
      'INSERT INTO staff_participants (staff_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    );

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const account of ACCOUNTS) {
        insertUser.run(randomUUID(), account.name, account.email, hashes[account.role], account.role, now);
      }
      for (const [staffEmail, participantEmail] of ASSIGNMENTS) {
        const staff = findUser.get(staffEmail);
        const participant = findUser.get(participantEmail);
        if (staff?.role === 'staff' && participant?.role === 'participant') {
          insertAssignment.run(staff.id, participant.id);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

await seed();

import { randomUUID } from 'node:crypto';
import { hashPassword, publicUser } from './security.js';
import { bodyFields, email, fail, password, text } from './validate.js';

// Admin-only routes: an overview of every account and assignment, doctor
// accounts, and patient–doctor assignments.
export function registerAdminRoutes(app, { db, userAuth, admin }) {
  function count(sql, ...params) {
    return db.prepare(sql).get(...params).n;
  }

  function id(value, field) {
    if (typeof value !== 'string' || !value || value.length > 100) fail(400, `${field} must be a string`);
    return value;
  }

  // Both ids must name accounts of the right type.
  function pair(body) {
    bodyFields(body, ['staff_id', 'participant_id']);
    const staffId = id(body.staff_id, 'staff_id');
    const participantId = id(body.participant_id, 'participant_id');
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'staff'").get(staffId)) fail(404, 'Doctor not found');
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'participant'").get(participantId)) fail(404, 'Patient not found');
    return { staff_id: staffId, participant_id: participantId };
  }

  app.get('/api/admin/overview', userAuth, admin, (req, res) => {
    const patients = db.prepare(`SELECT u.*,
        (SELECT s.id FROM exercise_sessions s WHERE s.participant_id = u.id AND s.status = 'active') AS active_session_id,
        (SELECT COUNT(*) FROM exercise_sessions s WHERE s.participant_id = u.id) AS session_count,
        (SELECT MAX(s.created_at) FROM exercise_sessions s WHERE s.participant_id = u.id) AS last_session_at,
        (SELECT COUNT(*) FROM workouts w WHERE w.participant_id = u.id) AS workout_count,
        (SELECT COUNT(*) FROM patient_messages m WHERE m.participant_id = u.id AND m.is_read = 0) AS unread_messages
      FROM users u WHERE u.role = 'participant' ORDER BY u.name COLLATE NOCASE, u.email`).all()
      .map(row => ({
        ...publicUser(row),
        active_session_id: row.active_session_id,
        session_count: row.session_count,
        last_session_at: row.last_session_at,
        workout_count: row.workout_count,
        unread_messages: row.unread_messages,
      }));
    const doctors = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM staff_participants sp WHERE sp.staff_id = u.id) AS patient_count
      FROM users u WHERE u.role = 'staff' ORDER BY u.name COLLATE NOCASE, u.email`).all()
      .map(row => ({ ...publicUser(row), patient_count: row.patient_count }));
    const assignments = db.prepare(`SELECT sp.staff_id, sp.participant_id FROM staff_participants sp
      JOIN users s ON s.id = sp.staff_id JOIN users p ON p.id = sp.participant_id
      ORDER BY s.name COLLATE NOCASE, p.name COLLATE NOCASE`).all()
      .map(row => ({ staff_id: row.staff_id, participant_id: row.participant_id }));
    const stats = {
      patients: patients.length,
      doctors: doctors.length,
      assignments: assignments.length,
      sessions: count('SELECT COUNT(*) AS n FROM exercise_sessions'),
      active_sessions: count("SELECT COUNT(*) AS n FROM exercise_sessions WHERE status = 'active'"),
      workouts: count('SELECT COUNT(*) AS n FROM workouts'),
      completed_workouts: count("SELECT COUNT(*) AS n FROM workouts WHERE status = 'completed'"),
      devices: count('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL'),
      messages: count('SELECT COUNT(*) AS n FROM patient_messages'),
      unread_messages: count('SELECT COUNT(*) AS n FROM patient_messages WHERE is_read = 0'),
    };
    res.json({ patients, doctors, assignments, stats });
  });

  app.post('/api/admin/doctors', userAuth, admin, async (req, res) => {
    bodyFields(req.body, ['name', 'email', 'password']);
    const name = text(req.body.name, 'name');
    const doctorEmail = email(req.body.email);
    const doctorPassword = password(req.body.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(doctorEmail)) fail(409, 'An account with this email already exists');
    const user = { id: randomUUID(), name, email: doctorEmail, role: 'staff', created_at: new Date().toISOString() };
    const passwordHash = await hashPassword(doctorPassword);
    db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.name, user.email, passwordHash, user.role, user.created_at);
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/admin/assignments', userAuth, admin, (req, res) => {
    const assignment = pair(req.body);
    const result = db.prepare('INSERT INTO staff_participants (staff_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(assignment.staff_id, assignment.participant_id);
    res.status(result.changes ? 201 : 200).json({ assignment, created: result.changes > 0 });
  });

  app.delete('/api/admin/assignments', userAuth, admin, (req, res) => {
    const assignment = pair(req.body);
    const result = db.prepare('DELETE FROM staff_participants WHERE staff_id = ? AND participant_id = ?')
      .run(assignment.staff_id, assignment.participant_id);
    if (!result.changes) fail(404, 'This patient is not assigned to this doctor');
    res.sendStatus(204);
  });
}

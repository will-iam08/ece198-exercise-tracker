import { randomUUID } from 'node:crypto';
import { EXERCISES } from './exercises.js';
import { bodyFields, fail, integer, queryFields, queryInteger } from './validate.js';

const sessionStatuses = ['active', 'ended'];
const OPEN = "status IN ('pending', 'active')";

export function registerSessionRoutes(app, { db, transaction, userAuth, participant, staffOrAdmin, canView }) {
  function withWorkouts(session) {
    const workouts = db.prepare("SELECT * FROM workouts WHERE session_id = ? AND kind = 'reps' ORDER BY created_at ASC, id ASC").all(session.id);
    return { ...session, workouts };
  }

  function getSession(id) {
    return db.prepare('SELECT * FROM exercise_sessions WHERE id = ?').get(id);
  }

  function ownedSession(req) {
    const session = getSession(req.params.id);
    if (!session || session.participant_id !== req.user.id) fail(404, 'Session not found');
    return session;
  }

  function readableSession(req) {
    const session = getSession(req.params.id);
    if (!session || !(session.participant_id === req.user.id || canView(req.user, session.participant_id))) {
      fail(404, 'Session not found');
    }
    return session;
  }

  function sessionList(participantId, query) {
    queryFields(query, ['limit', 'offset', 'status']);
    const limit = queryInteger(query.limit, 'limit', 10, 1, 50);
    const offset = queryInteger(query.offset, 'offset', 0, 0, 1_000_000_000);
    const conditions = ['participant_id = ?'];
    const params = [participantId];
    if (query.status !== undefined) {
      if (!sessionStatuses.includes(query.status)) fail(400, 'Invalid status');
      conditions.push('status = ?');
      params.push(query.status);
    }
    const where = conditions.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS total FROM exercise_sessions WHERE ${where}`).get(...params).total;
    const rows = db.prepare(`SELECT * FROM exercise_sessions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { sessions: rows.map(withWorkouts), limit, offset, total, server_time: new Date().toISOString() };
  }

  function endSession(session, now) {
    db.prepare(`UPDATE workouts SET status = 'incomplete', phase = 'done', ended_at = ?, updated_at = ?
      WHERE session_id = ? AND kind = 'reps' AND ${OPEN}`).run(now, now, session.id);
    db.prepare("UPDATE exercise_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?").run(now, now, session.id);
  }

  app.post('/api/sessions', userAuth, participant, (req, res) => {
    bodyFields(req.body, ['device_id']);
    if (typeof req.body.device_id !== 'string' || !req.body.device_id) fail(400, 'device_id must be a string');
    const id = randomUUID();
    transaction(() => {
      const device = db.prepare('SELECT id FROM devices WHERE id = ? AND participant_id = ? AND revoked_at IS NULL')
        .get(req.body.device_id, req.user.id);
      if (!device) fail(404, 'Device not found');
      const active = db.prepare("SELECT id FROM exercise_sessions WHERE participant_id = ? AND status = 'active'").get(req.user.id);
      if (active) fail(409, 'A session is already active', { session_id: active.id });
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO exercise_sessions (id, participant_id, device_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).run(id, req.user.id, device.id, now, now);
    });
    res.status(201).json({ session: withWorkouts(getSession(id)) });
  });

  app.get('/api/sessions', userAuth, participant, (req, res) => res.json(sessionList(req.user.id, req.query)));

  app.get('/api/participants/:id/sessions', userAuth, staffOrAdmin, (req, res) => {
    if (!canView(req.user, req.params.id)) fail(404, 'Participant not found');
    res.json(sessionList(req.params.id, req.query));
  });

  app.get('/api/sessions/:id', userAuth, (req, res) => {
    res.json({ session: withWorkouts(readableSession(req)), server_time: new Date().toISOString() });
  });

  app.post('/api/sessions/:id/exercises', userAuth, participant, (req, res) => {
    const owned = ownedSession(req);
    bodyFields(req.body, ['exercise_id', 'target_reps']);
    const exercise = EXERCISES.find(item => item.id === req.body.exercise_id);
    if (!exercise) fail(400, `exercise_id must be one of: ${EXERCISES.map(item => item.id).join(', ')}`);
    const targetReps = integer(req.body.target_reps, 'target_reps', 1, 50);
    const id = randomUUID();
    transaction(() => {
      const session = getSession(owned.id);
      if (session.status !== 'active') fail(409, 'Session has ended');
      const device = db.prepare('SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL').get(session.device_id);
      if (!device) fail(404, 'Device not found');
      if (db.prepare(`SELECT 1 FROM workouts WHERE session_id = ? AND ${OPEN}`).get(session.id)) {
        fail(409, 'Finish or stop the current exercise first');
      }
      if (db.prepare(`SELECT 1 FROM workouts WHERE device_id = ? AND ${OPEN}`).get(session.device_id)) {
        fail(409, 'This device already has an unfinished workout');
      }
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind, session_id, exercise_id,
        target_reps, phase, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'reps', ?, ?, ?, 'before_bpm', 'pending', ?, ?)`)
        .run(id, req.user.id, session.device_id, exercise.name, session.id, exercise.id, targetReps, now, now);
    });
    res.status(201).json({ workout: db.prepare('SELECT * FROM workouts WHERE id = ?').get(id) });
  });

  app.post('/api/sessions/:id/end', userAuth, participant, (req, res) => {
    const owned = ownedSession(req);
    transaction(() => {
      const session = getSession(owned.id);
      if (session.status === 'active') endSession(session, new Date().toISOString());
    });
    res.json({ session: withWorkouts(getSession(owned.id)) });
  });

  app.post('/api/workouts/:id/skip-reading', userAuth, participant, (req, res) => {
    const result = transaction(() => {
      const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(req.params.id);
      if (!workout || workout.participant_id !== req.user.id) fail(404, 'Workout not found');
      const now = new Date().toISOString();
      if (workout.kind === 'reps' && workout.phase === 'before_bpm') {
        db.prepare("UPDATE workouts SET before_skipped = 1, phase = 'counting', status = 'active', updated_at = ? WHERE id = ?")
          .run(now, workout.id);
      } else if (workout.kind === 'reps' && workout.phase === 'after_bpm') {
        db.prepare(`UPDATE workouts SET after_skipped = 1, phase = 'done', status = 'incomplete', ended_at = ?, updated_at = ?
          WHERE id = ?`).run(now, now, workout.id);
      } else {
        fail(409, 'There is no heart-rate reading to skip', { phase: workout.phase });
      }
      return db.prepare('SELECT * FROM workouts WHERE id = ?').get(workout.id);
    });
    res.json({ workout: result });
  });
}

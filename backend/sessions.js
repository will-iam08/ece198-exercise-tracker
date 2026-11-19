import { randomUUID } from 'node:crypto';
import { EXERCISES } from './exercises.js';
import { bodyFields, fail, integer, queryFields, queryInteger } from './validate.js';

const sessionStatuses = ['active', 'ended'];
const OPEN = "status IN ('pending', 'active')";

export function registerSessionRoutes(app, { db, transaction, userAuth, participant, staffOrAdmin, canView }) {
  async function withWorkouts(session, executor = db) {
    const workouts = await executor.all(
      "SELECT * FROM workouts WHERE session_id = ? AND kind = 'reps' ORDER BY created_at ASC, id ASC",
      session.id,
    );
    return { ...session, workouts };
  }

  async function getSession(id, executor = db) {
    return executor.get('SELECT * FROM exercise_sessions WHERE id = ?', id);
  }

  async function ownedSession(req) {
    const session = await getSession(req.params.id);
    if (!session || session.participant_id !== req.user.id) fail(404, 'Session not found');
    return session;
  }

  async function readableSession(req) {
    const session = await getSession(req.params.id);
    if (!session || !(session.participant_id === req.user.id || await canView(req.user, session.participant_id))) {
      fail(404, 'Session not found');
    }
    return session;
  }

  async function sessionList(participantId, query) {
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
    const { total } = await db.get(`SELECT COUNT(*) AS total FROM exercise_sessions WHERE ${where}`, ...params);
    const rows = await db.all(
      `SELECT * FROM exercise_sessions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const sessions = await Promise.all(rows.map(row => withWorkouts(row)));
    return { sessions, limit, offset, total, server_time: new Date().toISOString() };
  }

  async function endSession(tx, session, now) {
    await tx.run(`UPDATE workouts SET status = 'incomplete', phase = 'done', ended_at = ?, updated_at = ?
      WHERE session_id = ? AND kind = 'reps' AND ${OPEN}`, now, now, session.id);
    await tx.run("UPDATE exercise_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?", now, now, session.id);
  }

  app.post('/api/sessions', userAuth, participant, async (req, res) => {
    bodyFields(req.body, ['device_id']);
    if (typeof req.body.device_id !== 'string' || !req.body.device_id) fail(400, 'device_id must be a string');
    const id = randomUUID();
    const session = await transaction(async tx => {
      const device = await tx.get('SELECT id FROM devices WHERE id = ? AND participant_id = ? AND revoked_at IS NULL',
        req.body.device_id, req.user.id);
      if (!device) fail(404, 'Device not found');
      const active = await tx.get("SELECT id FROM exercise_sessions WHERE participant_id = ? AND status = 'active'", req.user.id);
      if (active) fail(409, 'A session is already active', { session_id: active.id });
      const now = new Date().toISOString();
      await tx.run(`INSERT INTO exercise_sessions (id, participant_id, device_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`, id, req.user.id, device.id, now, now);
      return withWorkouts(await getSession(id, tx), tx);
    });
    res.status(201).json({ session });
  });

  app.get('/api/sessions', userAuth, participant, async (req, res) => res.json(await sessionList(req.user.id, req.query)));

  app.get('/api/participants/:id/sessions', userAuth, staffOrAdmin, async (req, res) => {
    if (!await canView(req.user, req.params.id)) fail(404, 'Participant not found');
    res.json(await sessionList(req.params.id, req.query));
  });

  app.get('/api/sessions/:id', userAuth, async (req, res) => {
    res.json({ session: await withWorkouts(await readableSession(req)), server_time: new Date().toISOString() });
  });

  app.post('/api/sessions/:id/exercises', userAuth, participant, async (req, res) => {
    const owned = await ownedSession(req);
    bodyFields(req.body, ['exercise_id', 'target_reps']);
    const exercise = EXERCISES.find(item => item.id === req.body.exercise_id);
    if (!exercise) fail(400, `exercise_id must be one of: ${EXERCISES.map(item => item.id).join(', ')}`);
    const targetReps = integer(req.body.target_reps, 'target_reps', 1, 50);
    const id = randomUUID();
    const workout = await transaction(async tx => {
      const session = await getSession(owned.id, tx);
      if (session.status !== 'active') fail(409, 'Session has ended');
      const device = await tx.get('SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL', session.device_id);
      if (!device) fail(404, 'Device not found');
      if (await tx.get(`SELECT 1 FROM workouts WHERE session_id = ? AND ${OPEN}`, session.id)) {
        fail(409, 'Finish or stop the current exercise first');
      }
      if (await tx.get(`SELECT 1 FROM workouts WHERE device_id = ? AND ${OPEN}`, session.device_id)) {
        fail(409, 'This device already has an unfinished workout');
      }
      const now = new Date().toISOString();
      await tx.run(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind, session_id, exercise_id,
        target_reps, phase, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'reps', ?, ?, ?, 'before_bpm', 'pending', ?, ?)`,
        id, req.user.id, session.device_id, exercise.name, session.id, exercise.id, targetReps, now, now);
      return tx.get('SELECT * FROM workouts WHERE id = ?', id);
    });
    res.status(201).json({ workout });
  });

  app.post('/api/sessions/:id/end', userAuth, participant, async (req, res) => {
    const owned = await ownedSession(req);
    const session = await transaction(async tx => {
      const current = await getSession(owned.id, tx);
      if (current.status === 'active') await endSession(tx, current, new Date().toISOString());
      return withWorkouts(await getSession(owned.id, tx), tx);
    });
    res.json({ session });
  });

  app.post('/api/workouts/:id/skip-reading', userAuth, participant, async (req, res) => {
    const result = await transaction(async tx => {
      const workout = await tx.get('SELECT * FROM workouts WHERE id = ?', req.params.id);
      if (!workout || workout.participant_id !== req.user.id) fail(404, 'Workout not found');
      const now = new Date().toISOString();
      if (workout.kind === 'reps' && workout.phase === 'before_bpm') {
        await tx.run("UPDATE workouts SET before_skipped = 1, phase = 'counting', status = 'active', updated_at = ? WHERE id = ?",
          now, workout.id);
      } else if (workout.kind === 'reps' && workout.phase === 'after_bpm') {
        await tx.run(`UPDATE workouts SET after_skipped = 1, phase = 'done', status = 'incomplete', ended_at = ?, updated_at = ?
          WHERE id = ?`, now, now, workout.id);
      } else {
        fail(409, 'There is no heart-rate reading to skip', { phase: workout.phase });
      }
      return tx.get('SELECT * FROM workouts WHERE id = ?', workout.id);
    });
    res.json({ workout: result });
  });
}

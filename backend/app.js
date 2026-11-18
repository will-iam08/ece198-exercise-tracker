import express from 'express';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, hashToken, newToken, publicUser } from './security.js';
import { EXERCISES } from './exercises.js';
import { registerSessionRoutes } from './sessions.js';
import { applyDeviceEvent } from './deviceEvents.js';
import { bodyFields, fail, integer, queryFields, queryInteger, text } from './validate.js';

const legacyExercises = ['Bicep curls', 'Squats', 'Arm raises'];
const statuses = ['pending', 'active', 'completed', 'cancelled', 'incomplete'];
const kinds = ['timed', 'reps'];
const deviceFields = 'id, name, created_at, last_seen_at';

function email(value) {
  const normalized = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail(400, 'Invalid email address');
  return normalized;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'password must contain 12-128 characters');
  return value;
}

export function createApp({ db, corsOrigin = 'http://localhost:5173' }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin) {
      res.vary('Origin');
      if (req.headers.origin !== corsOrigin) return res.status(403).json({ error: { message: 'Origin is not allowed' } });
      res.set('Access-Control-Allow-Origin', corsOrigin);
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function bearer(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
    if (!match) fail(401, 'A valid Bearer token is required');
    return hashToken(match[1]);
  }

  function userAuth(req, res, next) {
    req.tokenHash = bearer(req);
    req.user = db.prepare(`SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(req.tokenHash, new Date().toISOString());
    if (!req.user) fail(401, 'Session is invalid or expired');
    next();
  }

  function participant(req, res, next) {
    if (req.user.role !== 'participant') fail(403, 'Participant access required');
    next();
  }

  function staff(req, res, next) {
    if (req.user.role !== 'staff') fail(403, 'Staff access required');
    next();
  }

  function deviceAuth(req, res, next) {
    req.device = db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(bearer(req));
    if (!req.device) fail(401, 'Device token is invalid or revoked');
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), req.device.id);
    next();
  }

  // shortcut: login throttling is per process, use a shared limiter if running multiple servers.
  const authAttempts = new Map();
  function authLimit(req, res, next) {
    const now = Date.now();
    for (const [key, value] of authAttempts) if (value.until <= now) authAttempts.delete(key);
    const entry = authAttempts.get(req.ip) || { count: 0, until: now + 15 * 60 * 1000 };
    authAttempts.set(req.ip, entry);
    if (++entry.count > 20) {
      res.set('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
      fail(429, 'Too many authentication attempts; try again later');
    }
    next();
  }

  function session(user) {
    const token = newToken('u_');
    const now = new Date().toISOString();
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), user.id, now, expires_at);
    return { token, expires_at, user: publicUser(user) };
  }

  function assigned(staffId, participantId) {
    return db.prepare('SELECT 1 FROM staff_participants WHERE staff_id = ? AND participant_id = ?').get(staffId, participantId);
  }

  function readableWorkout(req) {
    const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(req.params.id);
    if (!workout || !(workout.participant_id === req.user.id ||
      (req.user.role === 'staff' && assigned(req.user.id, workout.participant_id)))) fail(404, 'Workout not found');
    return workout;
  }

  function assignedParticipant(req, res, next) {
    if (!assigned(req.user.id, req.params.id)) fail(404, 'Participant not found');
    next();
  }

  function workoutList(participantId, query) {
    queryFields(query, ['limit', 'offset', 'status', 'exercise_name', 'kind']);
    const limit = queryInteger(query.limit, 'limit', 20, 1, 100);
    const offset = queryInteger(query.offset, 'offset', 0, 0, 1_000_000_000);
    const conditions = ['participant_id = ?'];
    const params = [participantId];
    if (query.status !== undefined) {
      if (!statuses.includes(query.status)) fail(400, 'Invalid status');
      conditions.push('status = ?');
      params.push(query.status);
    }
    if (query.exercise_name !== undefined) {
      conditions.push('exercise_name = ? COLLATE NOCASE');
      params.push(text(query.exercise_name, 'exercise_name'));
    }
    if (query.kind !== undefined) {
      if (!kinds.includes(query.kind)) fail(400, 'Invalid kind');
      conditions.push('kind = ?');
      params.push(query.kind);
    }
    const where = conditions.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS total FROM workouts WHERE ${where}`).get(...params).total;
    const workouts = db.prepare(`SELECT * FROM workouts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { workouts, limit, offset, total };
  }

  function progress(participantId, query) {
    queryFields(query, ['exercise_name', 'kind']);
    let where = "participant_id = ? AND status = 'completed'";
    const params = [participantId];
    if (query.exercise_name !== undefined) {
      where += ' AND exercise_name = ? COLLATE NOCASE';
      params.push(text(query.exercise_name, 'exercise_name'));
    }
    if (query.kind !== undefined) {
      if (!kinds.includes(query.kind)) fail(400, 'Invalid kind');
      where += ' AND kind = ?';
      params.push(query.kind);
    }
    const totals = db.prepare(`SELECT COUNT(*) AS completed_workouts, COALESCE(SUM(repetitions), 0) AS total_repetitions,
      COALESCE(SUM(elapsed_seconds), 0) AS total_duration_seconds FROM workouts WHERE ${where}`).get(...params);
    const daily = db.prepare(`SELECT substr(COALESCE(started_at, created_at), 1, 10) AS date, exercise_name, COUNT(*) AS workouts,
      SUM(repetitions) AS repetitions, SUM(elapsed_seconds) AS duration_seconds FROM workouts WHERE ${where}
      GROUP BY date, exercise_name COLLATE NOCASE ORDER BY date, exercise_name`).all(...params);
    return { ...totals, daily };
  }

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  app.get('/api/exercises', (req, res) => res.json({ exercises: EXERCISES }));

  app.post('/api/auth/register', authLimit, async (req, res) => {
    bodyFields(req.body, ['name', 'email', 'password']);
    const name = text(req.body.name, 'name');
    const userEmail = email(req.body.email);
    const userPassword = password(req.body.password);
    const passwordHash = await hashPassword(userPassword);
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, 'participant', ?)`).run(id, name, userEmail, passwordHash, new Date().toISOString());
    res.status(201).json(session(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  // A dummy hash keeps unknown-email and incorrect-password checks on the same slow path.
  const dummyHash = hashPassword(newToken('dummy_'));
  app.post('/api/auth/login', authLimit, async (req, res) => {
    bodyFields(req.body, ['email', 'password'], ['portal']);
    const userEmail = email(req.body.email);
    const userPassword = password(req.body.password);
    const portal = req.body.portal;
    if (portal !== undefined && !['patient', 'doctor'].includes(portal)) fail(400, 'portal must be patient or doctor');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(userEmail);
    const valid = await verifyPassword(userPassword, user ? user.password_hash : await dummyHash);
    if (!user || !valid) fail(401, 'Invalid email or password');
    if (portal === 'doctor' && user.role !== 'staff') fail(403, 'This is a patient account. Use the patient sign-in.');
    if (portal === 'patient' && user.role !== 'participant') fail(403, 'This is a doctor account. Use the doctor sign-in.');
    res.json(session(user));
  });

  app.post('/api/auth/logout', userAuth, (req, res) => {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(req.tokenHash);
    res.sendStatus(204);
  });
  app.get('/api/me', userAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  app.get('/api/devices', userAuth, participant, (req, res) => {
    const devices = db.prepare(`SELECT ${deviceFields} FROM devices WHERE participant_id = ? AND revoked_at IS NULL ORDER BY created_at, id`).all(req.user.id);
    res.json({ devices });
  });

  app.post('/api/devices', userAuth, participant, (req, res) => {
    bodyFields(req.body, ['name']);
    const name = text(req.body.name, 'name');
    const id = randomUUID();
    const token = newToken('d_');
    db.prepare('INSERT INTO devices (id, participant_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, name, hashToken(token), new Date().toISOString());
    res.status(201).json({ device: db.prepare(`SELECT ${deviceFields} FROM devices WHERE id = ?`).get(id), device_token: token });
  });

  app.delete('/api/devices/:id', userAuth, participant, (req, res) => {
    const device = db.prepare('SELECT id FROM devices WHERE id = ? AND participant_id = ? AND revoked_at IS NULL').get(req.params.id, req.user.id);
    if (!device) fail(404, 'Device not found');
    const now = new Date().toISOString();
    transaction(() => {
      db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').run(now, device.id);
      db.prepare(`UPDATE workouts SET status = CASE kind WHEN 'reps' THEN 'incomplete' ELSE 'cancelled' END,
        phase = CASE kind WHEN 'reps' THEN 'done' ELSE phase END, ended_at = ?, updated_at = ?
        WHERE device_id = ? AND status IN ('pending', 'active')`).run(now, now, device.id);
      db.prepare("UPDATE exercise_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE device_id = ? AND status = 'active'")
        .run(now, now, device.id);
    });
    res.sendStatus(204);
  });

  app.post('/api/workouts', userAuth, participant, (req, res) => {
    bodyFields(req.body, ['device_id', 'exercise_name', 'target_duration_seconds']);
    const deviceId = text(req.body.device_id, 'device_id');
    const name = text(req.body.exercise_name, 'exercise_name');
    const exerciseName = legacyExercises.find(item => item.toLowerCase() === name.toLowerCase()) || name;
    const target = integer(req.body.target_duration_seconds, 'target_duration_seconds', 1, 86400);
    const device = db.prepare('SELECT id FROM devices WHERE id = ? AND participant_id = ? AND revoked_at IS NULL').get(deviceId, req.user.id);
    if (!device) fail(404, 'Device not found');
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind, target_duration_seconds, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'timed', ?, 'pending', ?, ?)`).run(id, req.user.id, deviceId, exerciseName, target, now, now);
    res.status(201).json({ workout: db.prepare('SELECT * FROM workouts WHERE id = ?').get(id) });
  });

  app.get('/api/workouts', userAuth, participant, (req, res) => res.json(workoutList(req.user.id, req.query)));
  app.get('/api/progress', userAuth, participant, (req, res) => res.json(progress(req.user.id, req.query)));
  app.get('/api/workouts/:id', userAuth, (req, res) => res.json({ workout: readableWorkout(req) }));

  app.get('/api/workouts/:id/readings', userAuth, (req, res) => {
    const workout = readableWorkout(req);
    queryFields(req.query, ['limit', 'offset']);
    const limit = queryInteger(req.query.limit, 'limit', 100, 1, 1000);
    const offset = queryInteger(req.query.offset, 'offset', 0, 0, 1_000_000_000);
    const readings = db.prepare('SELECT * FROM workout_readings WHERE workout_id = ? ORDER BY sequence LIMIT ? OFFSET ?').all(workout.id, limit, offset);
    const total = db.prepare('SELECT COUNT(*) AS total FROM workout_readings WHERE workout_id = ?').get(workout.id).total;
    res.json({ readings, limit, offset, total });
  });

  app.post('/api/workouts/:id/cancel', userAuth, participant, (req, res) => {
    const workout = readableWorkout(req);
    if (workout.status === 'completed') fail(409, 'A completed workout cannot be cancelled');
    if (workout.kind === 'reps') {
      if (workout.status !== 'incomplete') {
        const now = new Date().toISOString();
        db.prepare("UPDATE workouts SET status = 'incomplete', phase = 'done', ended_at = ?, updated_at = ? WHERE id = ?").run(now, now, workout.id);
      }
    } else if (workout.status !== 'cancelled') {
      const now = new Date().toISOString();
      db.prepare("UPDATE workouts SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE id = ?").run(now, now, workout.id);
    }
    res.json({ workout: db.prepare('SELECT * FROM workouts WHERE id = ?').get(workout.id) });
  });

  app.get('/api/participants', userAuth, staff, (req, res) => {
    const participants = db.prepare(`SELECT u.*, (SELECT s.id FROM exercise_sessions s
      WHERE s.participant_id = u.id AND s.status = 'active') AS active_session_id
      FROM users u JOIN staff_participants sp ON sp.participant_id = u.id
      WHERE sp.staff_id = ? ORDER BY u.name, u.id`).all(req.user.id)
      .map(row => ({ ...publicUser(row), active_session_id: row.active_session_id }));
    res.json({ participants });
  });
  app.get('/api/participants/:id/workouts', userAuth, staff, assignedParticipant,
    (req, res) => res.json(workoutList(req.params.id, req.query)));
  app.get('/api/participants/:id/progress', userAuth, staff, assignedParticipant,
    (req, res) => res.json(progress(req.params.id, req.query)));

  registerSessionRoutes(app, { db, transaction, userAuth, participant, staff, assigned });

  app.get('/api/device/workout', deviceAuth, (req, res) => {
    const workout = db.prepare("SELECT * FROM workouts WHERE device_id = ? AND status IN ('pending', 'active')").get(req.device.id);
    if (workout) {
      workout.device_seen_at = new Date().toISOString();
      db.prepare('UPDATE workouts SET device_seen_at = ? WHERE id = ?').run(workout.device_seen_at, workout.id);
    }
    res.json({ workout: workout || null });
  });

  app.post('/api/device/workouts/:id/updates', deviceAuth, (req, res) => {
    const target = db.prepare('SELECT kind FROM workouts WHERE id = ? AND device_id = ?').get(req.params.id, req.device.id);
    if (target?.kind === 'reps') {
      res.json(transaction(() => {
        const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND device_id = ?').get(req.params.id, req.device.id);
        if (!workout) fail(404, 'Workout not found');
        return applyDeviceEvent(db, workout, req.body, new Date().toISOString());
      }));
      return;
    }
    bodyFields(req.body, ['sequence', 'repetitions', 'elapsed_seconds'], ['heart_rate_bpm', 'completed']);
    const sequence = integer(req.body.sequence, 'sequence', 1, 2_147_483_647);
    const repetitions = integer(req.body.repetitions, 'repetitions', 0, 1_000_000);
    const elapsed = integer(req.body.elapsed_seconds, 'elapsed_seconds', 0, 86400);
    const heartRate = req.body.heart_rate_bpm == null ? null : integer(req.body.heart_rate_bpm, 'heart_rate_bpm', 1, 300);
    if (req.body.completed !== undefined && typeof req.body.completed !== 'boolean') fail(400, 'completed must be a boolean');
    const completed = req.body.completed === true ? 1 : 0;
    const result = transaction(() => {
      const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND device_id = ?').get(req.params.id, req.device.id);
      if (!workout) fail(404, 'Workout not found');
      const existing = db.prepare('SELECT * FROM workout_readings WHERE workout_id = ? AND sequence = ?').get(workout.id, sequence);
      if (existing) {
        if (existing.repetitions !== repetitions || existing.elapsed_seconds !== elapsed || existing.heart_rate_bpm !== heartRate || existing.completed !== completed) {
          fail(409, 'Sequence already exists with different data');
        }
        return { workout, duplicate: true };
      }
      if (!['pending', 'active'].includes(workout.status)) fail(409, 'Workout has ended');
      if (sequence <= workout.last_sequence) fail(409, 'Sequence must increase');
      if (repetitions < workout.repetitions || elapsed < workout.elapsed_seconds) fail(409, 'Cumulative repetitions and elapsed time cannot decrease');
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO workout_readings (workout_id, sequence, repetitions, elapsed_seconds, heart_rate_bpm, completed, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(workout.id, sequence, repetitions, elapsed, heartRate, completed, now);
      db.prepare(`UPDATE workouts SET status = ?, repetitions = ?, elapsed_seconds = ?, heart_rate_bpm = COALESCE(?, heart_rate_bpm),
        last_sequence = ?, started_at = COALESCE(started_at, ?), ended_at = ?, updated_at = ? WHERE id = ?`)
        .run(completed ? 'completed' : 'active', repetitions, elapsed, heartRate, sequence, now, completed ? now : null, now, workout.id);
      return { workout: db.prepare('SELECT * FROM workouts WHERE id = ?').get(workout.id), duplicate: false };
    });
    res.json(result);
  });

  app.use((req, res) => res.status(404).json({ error: { message: 'Route not found' } }));
  app.use((error, req, res, next) => {
    let status = error.status || 500;
    let message = error.message;
    if (error.type === 'entity.parse.failed') message = 'Malformed JSON body';
    if (error.type === 'entity.too.large') message = 'JSON body exceeds 16kb';
    if ([1555, 2067].includes(error.errcode)) {
      status = 409;
      message = 'Record already exists, or this device already has an unfinished workout';
    }
    if (status >= 500) {
      console.error('Request failed:', error.code || error.name);
      message = 'Internal server error';
    }
    res.status(status).json({ error: { message, ...(status < 500 ? error.extra : {}) } });
  });
  return app;
}

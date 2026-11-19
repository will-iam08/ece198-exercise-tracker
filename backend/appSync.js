import { randomUUID } from 'node:crypto';
import { resolveAppExercise } from './exercises.js';
import { bodyFields, fail, integer } from './validate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_PHASES = ['before_bpm', 'counting', 'after_bpm'];
const LIVE_DEVICE_STATUSES = ['waiting_finger', 'reading', 'weak_signal', 'counting'];

function uuidField(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    fail(400, `${field} must be a valid UUID`);
  }
  return value.trim().toLowerCase();
}

function booleanField(value, field) {
  if (typeof value !== 'boolean') fail(400, `${field} must be a boolean`);
  return value;
}

function nullableBpm(value, field) {
  if (value === null) return null;
  return integer(value, field, 1, 300);
}

function isoTimestamp(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) {
    fail(400, `${field} must be an ISO 8601 timestamp`);
  }
  const ms = Date.parse(value.trim());
  if (!Number.isFinite(ms)) fail(400, `${field} must be a valid ISO 8601 timestamp`);
  return { iso: new Date(ms).toISOString(), ms };
}

function parseSetBody(body) {
  bodyFields(body, [
    'client_id',
    'exercise',
    'target_reps',
    'repetitions',
    'elapsed_seconds',
    'before_bpm',
    'after_bpm',
    'before_skipped',
    'after_skipped',
    'started_at',
    'ended_at',
  ]);
  const clientId = uuidField(body.client_id, 'client_id');
  const exercise = resolveAppExercise(body.exercise);
  if (!exercise) fail(400, 'exercise must be one of wire codes 1, 3, 4 or arm_curl, shoulder_press, back_row');
  const targetReps = integer(body.target_reps, 'target_reps', 1, 50);
  const repetitions = integer(body.repetitions, 'repetitions', 0, 50);
  if (repetitions > targetReps) fail(400, `repetitions cannot exceed target_reps (${targetReps})`);
  const elapsedSeconds = integer(body.elapsed_seconds, 'elapsed_seconds', 0, 86400);
  const beforeBpm = nullableBpm(body.before_bpm, 'before_bpm');
  const afterBpm = nullableBpm(body.after_bpm, 'after_bpm');
  const beforeSkipped = booleanField(body.before_skipped, 'before_skipped');
  const afterSkipped = booleanField(body.after_skipped, 'after_skipped');
  if (beforeSkipped && beforeBpm !== null) fail(400, 'before_bpm must be null when before_skipped is true');
  if (afterSkipped && afterBpm !== null) fail(400, 'after_bpm must be null when after_skipped is true');
  const started = isoTimestamp(body.started_at, 'started_at');
  const ended = isoTimestamp(body.ended_at, 'ended_at');
  if (ended.ms < started.ms) fail(400, 'ended_at must not be earlier than started_at');

  const complete = repetitions === targetReps && beforeBpm !== null && afterBpm !== null;
  return {
    clientId,
    exercise,
    targetReps,
    repetitions,
    elapsedSeconds,
    beforeBpm,
    afterBpm,
    beforeSkipped: beforeSkipped ? 1 : 0,
    afterSkipped: afterSkipped ? 1 : 0,
    startedAt: started.iso,
    endedAt: ended.iso,
    status: complete ? 'completed' : 'incomplete',
  };
}

function matchesStoredSet(existing, set) {
  return existing.exercise_id === set.exercise.id
    && existing.target_reps === set.targetReps
    && existing.repetitions === set.repetitions
    && existing.elapsed_seconds === set.elapsedSeconds
    && existing.before_bpm === set.beforeBpm
    && existing.after_bpm === set.afterBpm
    && existing.before_skipped === set.beforeSkipped
    && existing.after_skipped === set.afterSkipped
    && existing.started_at === set.startedAt
    && existing.ended_at === set.endedAt
    && existing.status === set.status;
}

function parseLiveBody(body) {
  bodyFields(
    body,
    ['client_id', 'exercise', 'target_reps', 'repetitions', 'elapsed_seconds', 'phase'],
    ['before_bpm', 'before_skipped', 'device_status'],
  );
  const clientId = uuidField(body.client_id, 'client_id');
  const exercise = resolveAppExercise(body.exercise);
  if (!exercise) fail(400, 'exercise must be one of wire codes 1, 3, 4 or arm_curl, shoulder_press, back_row');
  const targetReps = integer(body.target_reps, 'target_reps', 1, 50);
  const repetitions = integer(body.repetitions, 'repetitions', 0, 50);
  if (repetitions > targetReps) fail(400, `repetitions cannot exceed target_reps (${targetReps})`);
  const elapsedSeconds = integer(body.elapsed_seconds, 'elapsed_seconds', 0, 86400);
  if (typeof body.phase !== 'string' || !LIVE_PHASES.includes(body.phase)) {
    fail(400, `phase must be one of: ${LIVE_PHASES.join(', ')}`);
  }
  const beforeSkipped = body.before_skipped === undefined ? false : booleanField(body.before_skipped, 'before_skipped');
  const beforeBpm = body.before_bpm === undefined ? null : nullableBpm(body.before_bpm, 'before_bpm');
  if (beforeSkipped && beforeBpm !== null) fail(400, 'before_bpm must be null when before_skipped is true');
  let deviceStatus = null;
  if (body.device_status !== undefined && body.device_status !== null) {
    if (typeof body.device_status !== 'string' || !LIVE_DEVICE_STATUSES.includes(body.device_status)) {
      fail(400, `device_status must be one of: ${LIVE_DEVICE_STATUSES.join(', ')}`);
    }
    deviceStatus = body.device_status;
  }
  return {
    clientId,
    exercise,
    targetReps,
    repetitions,
    elapsedSeconds,
    phase: body.phase,
    beforeBpm,
    beforeSkipped: beforeSkipped ? 1 : 0,
    deviceStatus,
  };
}

function createUserRateLimiter(maxRequests, windowMs) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = req.user.id;
    const nowMs = Date.now();
    if (buckets.size > 1000) {
      for (const [k, entry] of buckets) {
        if (nowMs >= entry.resetAt) buckets.delete(k);
      }
    }
    const bucket = buckets.get(key);
    if (!bucket || nowMs >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
      return next();
    }
    if (bucket.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
      res.set('Retry-After', String(retryAfter));
      return next(Object.assign(new Error('Live update rate limit exceeded. Wait a moment and try again.'), { status: 429 }));
    }
    bucket.count += 1;
    return next();
  };
}

async function sessionWithWorkouts(tx, sessionId) {
  const session = await tx.get('SELECT * FROM exercise_sessions WHERE id = ?', sessionId);
  if (!session) return null;
  const workouts = await tx.all("SELECT * FROM workouts WHERE session_id = ? AND kind = 'reps' ORDER BY created_at ASC, id ASC", sessionId);
  return { ...session, workouts };
}

async function closeActiveAppSession(tx, participantId) {
  const active = await tx.get("SELECT id, source FROM exercise_sessions WHERE participant_id = ? AND status = 'active'", participantId);
  if (!active) return null;
  if (active.source !== 'app') return active;
  await tx.run("DELETE FROM workouts WHERE session_id = ? AND source = 'app' AND status IN ('pending', 'active')", active.id);
  const remaining = await tx.get('SELECT 1 AS present FROM workouts WHERE session_id = ? LIMIT 1', active.id);
  if (!remaining) {
    await tx.run('DELETE FROM exercise_sessions WHERE id = ?', active.id);
  }
  return null;
}

export function registerAppSyncRoutes(app, { transaction, userAuth, participant }, options = {}) {
  const liveLimitMax = options.liveLimitMax ?? 30;
  const liveLimitWindowMs = options.liveLimitWindowMs ?? 10_000;
  const liveLimiter = createUserRateLimiter(liveLimitMax, liveLimitWindowMs);

  app.post('/api/app/sets', userAuth, participant, async (req, res) => {
    const set = parseSetBody(req.body);
    const now = new Date().toISOString();

    const result = await transaction(async tx => {
      const existing = await tx.get('SELECT * FROM workouts WHERE participant_id = ? AND client_id = ?',
        req.user.id, set.clientId);

      if (existing && ['completed', 'incomplete'].includes(existing.status)) {
        if (!matchesStoredSet(existing, set)) {
          fail(409, 'Set client_id already exists with different data');
        }
        return {
          status: 200,
          duplicate: true,
          workout: existing,
          session: await sessionWithWorkouts(tx, existing.session_id),
        };
      }

      if (existing && ['pending', 'active'].includes(existing.status)) {
        await tx.run(`UPDATE workouts SET
          exercise_name = ?, exercise_id = ?, target_reps = ?, repetitions = ?, elapsed_seconds = ?,
          phase = 'done', status = ?, before_bpm = ?, before_bpm_at = ?, after_bpm = ?, after_bpm_at = ?,
          before_skipped = ?, after_skipped = ?, device_status = NULL, created_at = ?, started_at = ?, ended_at = ?, updated_at = ?
          WHERE id = ?`,
          set.exercise.name, set.exercise.id, set.targetReps, set.repetitions, set.elapsedSeconds,
          set.status, set.beforeBpm, set.beforeBpm !== null ? set.startedAt : null,
          set.afterBpm, set.afterBpm !== null ? set.endedAt : null,
          set.beforeSkipped, set.afterSkipped, set.startedAt, set.startedAt, set.endedAt, now, existing.id,
        );
        await tx.run("UPDATE exercise_sessions SET status = 'ended', created_at = ?, ended_at = ?, updated_at = ? WHERE id = ?",
          set.startedAt, set.endedAt, now, existing.session_id);
        return {
          status: 201,
          duplicate: false,
          workout: await tx.get('SELECT * FROM workouts WHERE id = ?', existing.id),
          session: await sessionWithWorkouts(tx, existing.session_id),
        };
      }

      const sessionId = randomUUID();
      const workoutId = randomUUID();
      await tx.run(`INSERT INTO exercise_sessions (id, participant_id, device_id, source, status, created_at, ended_at, updated_at)
        VALUES (?, ?, NULL, 'app', 'ended', ?, ?, ?)`, sessionId, req.user.id, set.startedAt, set.endedAt, now);
      await tx.run(`INSERT INTO workouts (
        id, participant_id, device_id, source, client_id, exercise_name, kind, session_id, exercise_id,
        target_reps, phase, status, repetitions, elapsed_seconds, before_bpm, before_bpm_at, after_bpm, after_bpm_at,
        before_skipped, after_skipped, created_at, started_at, ended_at, updated_at
      ) VALUES (?, ?, NULL, 'app', ?, ?, 'reps', ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        workoutId, req.user.id, set.clientId, set.exercise.name, sessionId, set.exercise.id,
        set.targetReps, set.status, set.repetitions, set.elapsedSeconds,
        set.beforeBpm, set.beforeBpm !== null ? set.startedAt : null,
        set.afterBpm, set.afterBpm !== null ? set.endedAt : null,
        set.beforeSkipped, set.afterSkipped, set.startedAt, set.startedAt, set.endedAt, now,
      );
      return {
        status: 201,
        duplicate: false,
        workout: await tx.get('SELECT * FROM workouts WHERE id = ?', workoutId),
        session: await sessionWithWorkouts(tx, sessionId),
      };
    });

    res.status(result.status).json({
      workout: result.workout,
      session: result.session,
      duplicate: result.duplicate,
    });
  });

  app.put('/api/app/live', userAuth, participant, liveLimiter, async (req, res) => {
    const live = parseLiveBody(req.body);
    const now = new Date().toISOString();

    const result = await transaction(async tx => {
      const byClient = await tx.get('SELECT * FROM workouts WHERE participant_id = ? AND client_id = ?',
        req.user.id, live.clientId);
      if (byClient && ['completed', 'incomplete'].includes(byClient.status)) {
        fail(409, 'This workout set has already finished');
      }

      if (byClient && ['pending', 'active'].includes(byClient.status)) {
        await tx.run(`UPDATE workouts SET
          exercise_name = ?, exercise_id = ?, target_reps = ?, repetitions = ?, elapsed_seconds = ?,
          phase = ?, status = 'active', before_bpm = ?, before_bpm_at = COALESCE(before_bpm_at, ?),
          before_skipped = ?, device_status = ?, device_seen_at = ?, updated_at = ?
          WHERE id = ?`,
          live.exercise.name, live.exercise.id, live.targetReps, live.repetitions, live.elapsedSeconds,
          live.phase, live.beforeBpm, live.beforeBpm !== null ? now : null,
          live.beforeSkipped, live.deviceStatus, now, now, byClient.id,
        );
        await tx.run('UPDATE exercise_sessions SET updated_at = ? WHERE id = ?', now, byClient.session_id);
        return {
          workout: await tx.get('SELECT * FROM workouts WHERE id = ?', byClient.id),
          session: await sessionWithWorkouts(tx, byClient.session_id),
        };
      }

      const blocking = await closeActiveAppSession(tx, req.user.id);
      if (blocking) {
        fail(409, 'You already have an active Wi-Fi exercise session');
      }

      const sessionId = randomUUID();
      const workoutId = randomUUID();
      await tx.run(`INSERT INTO exercise_sessions (id, participant_id, device_id, source, status, created_at, updated_at)
        VALUES (?, ?, NULL, 'app', 'active', ?, ?)`, sessionId, req.user.id, now, now);
      await tx.run(`INSERT INTO workouts (
        id, participant_id, device_id, source, client_id, exercise_name, kind, session_id, exercise_id,
        target_reps, phase, status, repetitions, elapsed_seconds, before_bpm, before_bpm_at,
        before_skipped, device_status, device_seen_at, created_at, started_at, updated_at
      ) VALUES (?, ?, NULL, 'app', ?, ?, 'reps', ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        workoutId, req.user.id, live.clientId, live.exercise.name, sessionId, live.exercise.id,
        live.targetReps, live.phase, live.repetitions, live.elapsedSeconds,
        live.beforeBpm, live.beforeBpm !== null ? now : null,
        live.beforeSkipped, live.deviceStatus, now, now, now, now,
      );
      return {
        workout: await tx.get('SELECT * FROM workouts WHERE id = ?', workoutId),
        session: await sessionWithWorkouts(tx, sessionId),
      };
    });

    res.json({ ...result, server_time: now });
  });

  app.delete('/api/app/live', userAuth, participant, async (req, res) => {
    await transaction(async tx => {
      await closeActiveAppSession(tx, req.user.id);
    });
    res.sendStatus(204);
  });
}

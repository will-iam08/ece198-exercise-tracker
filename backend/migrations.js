import { readFileSync } from 'node:fs';

export const LATEST_VERSION = 4;

const SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY
) STRICT;
`;

const SCHEMA_V4_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('participant', 'staff', 'admin')),
    created_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS staff_participants (
    staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (staff_id, participant_id),
    CHECK (staff_id <> participant_id)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    UNIQUE (id, participant_id)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS exercise_sessions (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT,
    source TEXT NOT NULL DEFAULT 'device' CHECK (source IN ('device', 'app')),
    status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
    created_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (device_id, participant_id) REFERENCES devices(id, participant_id),
    CHECK (source = 'app' OR device_id IS NOT NULL)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT,
    source TEXT NOT NULL DEFAULT 'device' CHECK (source IN ('device', 'app')),
    client_id TEXT CHECK (client_id IS NULL OR length(trim(client_id)) BETWEEN 1 AND 128),
    exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) BETWEEN 1 AND 80),
    kind TEXT NOT NULL DEFAULT 'timed' CHECK (kind IN ('timed', 'reps')),
    target_duration_seconds INTEGER,
    session_id TEXT REFERENCES exercise_sessions(id) ON DELETE CASCADE,
    exercise_id TEXT,
    target_reps INTEGER,
    phase TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'incomplete')),
    repetitions INTEGER NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
    elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds BETWEEN 0 AND 86400),
    heart_rate_bpm INTEGER CHECK (heart_rate_bpm BETWEEN 1 AND 300),
    before_bpm INTEGER CHECK (before_bpm IS NULL OR before_bpm BETWEEN 1 AND 300),
    before_bpm_at TEXT,
    after_bpm INTEGER CHECK (after_bpm IS NULL OR after_bpm BETWEEN 1 AND 300),
    after_bpm_at TEXT,
    before_skipped INTEGER NOT NULL DEFAULT 0 CHECK (before_skipped IN (0, 1)),
    after_skipped INTEGER NOT NULL DEFAULT 0 CHECK (after_skipped IN (0, 1)),
    device_status TEXT CHECK (device_status IS NULL OR device_status IN ('waiting_finger', 'reading', 'weak_signal', 'counting')),
    device_seen_at TEXT,
    last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (device_id, participant_id) REFERENCES devices(id, participant_id),
    CHECK (source = 'app' OR device_id IS NOT NULL),
    CHECK (
      (kind = 'timed' AND target_duration_seconds IS NOT NULL AND target_duration_seconds BETWEEN 1 AND 86400)
      OR (kind = 'reps'
        AND session_id IS NOT NULL
        AND exercise_id IS NOT NULL AND exercise_id IN ('arm_curl', 'shoulder_press', 'back_row')
        AND target_reps IS NOT NULL AND target_reps BETWEEN 1 AND 50
        AND phase IS NOT NULL AND phase IN ('before_bpm', 'counting', 'after_bpm', 'done'))
    )
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS workout_readings (
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    repetitions INTEGER NOT NULL CHECK (repetitions >= 0),
    elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds BETWEEN 0 AND 86400),
    heart_rate_bpm INTEGER CHECK (heart_rate_bpm BETWEEN 1 AND 300),
    completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
    received_at TEXT NOT NULL,
    PRIMARY KEY (workout_id, sequence)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS workout_events (
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    type TEXT NOT NULL CHECK (type IN ('status', 'before_bpm', 'progress', 'after_bpm')),
    repetitions INTEGER CHECK (repetitions IS NULL OR repetitions >= 0),
    bpm INTEGER CHECK (bpm IS NULL OR bpm BETWEEN 1 AND 300),
    capture_status TEXT,
    received_at TEXT NOT NULL,
    PRIMARY KEY (workout_id, sequence)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS patient_plans (
    participant_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    staff_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
    arm_curl_reps INTEGER CHECK (arm_curl_reps IS NULL OR arm_curl_reps BETWEEN 1 AND 50),
    shoulder_press_reps INTEGER CHECK (shoulder_press_reps IS NULL OR shoulder_press_reps BETWEEN 1 AND 50),
    back_row_reps INTEGER CHECK (back_row_reps IS NULL OR back_row_reps BETWEEN 1 AND 50),
    target_bpm_min INTEGER CHECK (target_bpm_min IS NULL OR target_bpm_min BETWEEN 30 AND 220),
    target_bpm_max INTEGER CHECK (target_bpm_max IS NULL OR target_bpm_max BETWEEN 30 AND 220),
    updated_at TEXT NOT NULL,
    CHECK (target_bpm_min IS NULL OR target_bpm_max IS NULL OR target_bpm_min <= target_bpm_max)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS patient_messages (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_email TEXT NOT NULL,
    subject TEXT NOT NULL CHECK (length(subject) <= 200),
    body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
    source TEXT NOT NULL DEFAULT 'email_bot' CHECK (source IN ('email_bot', 'portal')),
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    doctor_reply TEXT CHECK (doctor_reply IS NULL OR length(doctor_reply) <= 4000),
    replied_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    replied_at TEXT,
    received_at TEXT NOT NULL
  ) STRICT`,
  'CREATE INDEX IF NOT EXISTS idx_staff_participants_participant ON staff_participants(participant_id)',
  'CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_active ON exercise_sessions(participant_id) WHERE status = 'active'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_device_open ON workouts(device_id) WHERE device_id IS NOT NULL AND status IN ('pending', 'active')",
  'CREATE INDEX IF NOT EXISTS idx_workouts_participant_created ON workouts(participant_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_workouts_session ON workouts(session_id, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_participant_client ON workouts(participant_id, client_id) WHERE client_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_patient_messages_participant ON patient_messages(participant_id, received_at DESC)',
];

const SESSIONS_SQL = `
CREATE TABLE exercise_sessions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id, participant_id) REFERENCES devices(id, participant_id)
) STRICT;

CREATE UNIQUE INDEX idx_sessions_active
  ON exercise_sessions(participant_id) WHERE status = 'active';
`;

const WORKOUTS_NEW_SQL = `
CREATE TABLE workouts_new (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL DEFAULT 'timed' CHECK (kind IN ('timed', 'reps')),
  target_duration_seconds INTEGER,
  session_id TEXT REFERENCES exercise_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT,
  target_reps INTEGER,
  phase TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'incomplete')),
  repetitions INTEGER NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds BETWEEN 0 AND 86400),
  heart_rate_bpm INTEGER CHECK (heart_rate_bpm BETWEEN 1 AND 300),
  before_bpm INTEGER CHECK (before_bpm IS NULL OR before_bpm BETWEEN 1 AND 300),
  before_bpm_at TEXT,
  after_bpm INTEGER CHECK (after_bpm IS NULL OR after_bpm BETWEEN 1 AND 300),
  after_bpm_at TEXT,
  before_skipped INTEGER NOT NULL DEFAULT 0 CHECK (before_skipped IN (0, 1)),
  after_skipped INTEGER NOT NULL DEFAULT 0 CHECK (after_skipped IN (0, 1)),
  device_status TEXT CHECK (device_status IS NULL OR device_status IN ('waiting_finger', 'reading', 'weak_signal', 'counting')),
  device_seen_at TEXT,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id, participant_id) REFERENCES devices(id, participant_id),
  CHECK (
    (kind = 'timed' AND target_duration_seconds IS NOT NULL AND target_duration_seconds BETWEEN 1 AND 86400)
    OR (kind = 'reps'
      AND session_id IS NOT NULL
      AND exercise_id IS NOT NULL AND exercise_id IN ('arm_curl', 'shoulder_press', 'back_row')
      AND target_reps IS NOT NULL AND target_reps BETWEEN 1 AND 50
      AND phase IS NOT NULL AND phase IN ('before_bpm', 'counting', 'after_bpm', 'done'))
  )
) STRICT;
`;

const COPY_WORKOUTS_SQL = `
INSERT INTO workouts_new (
  id, participant_id, device_id, exercise_name, kind, target_duration_seconds, status,
  repetitions, elapsed_seconds, heart_rate_bpm, last_sequence, created_at, started_at, ended_at, updated_at
)
SELECT
  id, participant_id, device_id, exercise_name, 'timed', target_duration_seconds, status,
  repetitions, elapsed_seconds, heart_rate_bpm, last_sequence, created_at, started_at, ended_at, updated_at
FROM workouts;
`;

const INDEXES_SQL = `
CREATE UNIQUE INDEX idx_workouts_device_open
  ON workouts(device_id) WHERE status IN ('pending', 'active');
CREATE INDEX idx_workouts_participant_created
  ON workouts(participant_id, created_at DESC);
CREATE INDEX idx_workouts_session
  ON workouts(session_id, created_at);
`;

const EVENTS_SQL = `
CREATE TABLE workout_events (
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL CHECK (type IN ('status', 'before_bpm', 'progress', 'after_bpm')),
  repetitions INTEGER CHECK (repetitions IS NULL OR repetitions >= 0),
  bpm INTEGER CHECK (bpm IS NULL OR bpm BETWEEN 1 AND 300),
  capture_status TEXT,
  received_at TEXT NOT NULL,
  PRIMARY KEY (workout_id, sequence)
) STRICT;
`;

async function toVersion2(db) {
  await db.exec(SESSIONS_SQL);
  await db.exec(WORKOUTS_NEW_SQL);
  await db.exec(COPY_WORKOUTS_SQL);
  await db.exec('DROP TABLE workouts');
  await db.exec('ALTER TABLE workouts_new RENAME TO workouts');
  await db.exec(INDEXES_SQL);
  await db.exec(EVENTS_SQL);
}

const USERS_NEW_SQL = `
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('participant', 'staff', 'admin')),
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO users_new (id, name, email, password_hash, role, created_at)
SELECT id, name, email, password_hash, role, created_at FROM users;
`;

const PLANS_SQL = `
CREATE TABLE patient_plans (
  participant_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  staff_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  arm_curl_reps INTEGER CHECK (arm_curl_reps IS NULL OR arm_curl_reps BETWEEN 1 AND 50),
  shoulder_press_reps INTEGER CHECK (shoulder_press_reps IS NULL OR shoulder_press_reps BETWEEN 1 AND 50),
  back_row_reps INTEGER CHECK (back_row_reps IS NULL OR back_row_reps BETWEEN 1 AND 50),
  target_bpm_min INTEGER CHECK (target_bpm_min IS NULL OR target_bpm_min BETWEEN 30 AND 220),
  target_bpm_max INTEGER CHECK (target_bpm_max IS NULL OR target_bpm_max BETWEEN 30 AND 220),
  updated_at TEXT NOT NULL,
  CHECK (target_bpm_min IS NULL OR target_bpm_max IS NULL OR target_bpm_min <= target_bpm_max)
) STRICT;
`;

const MESSAGES_SQL = `
CREATE TABLE patient_messages (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  subject TEXT NOT NULL CHECK (length(subject) <= 200),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  source TEXT NOT NULL DEFAULT 'email_bot' CHECK (source IN ('email_bot', 'portal')),
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  doctor_reply TEXT CHECK (doctor_reply IS NULL OR length(doctor_reply) <= 4000),
  replied_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  replied_at TEXT,
  received_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_patient_messages_participant
  ON patient_messages(participant_id, received_at DESC);
`;

async function toVersion3(db) {
  await db.exec(USERS_NEW_SQL);
  await db.exec('DROP TABLE users');
  await db.exec('ALTER TABLE users_new RENAME TO users');
  await db.exec(PLANS_SQL);
  await db.exec(MESSAGES_SQL);
}

const SESSIONS_V4_SQL = `
CREATE TABLE exercise_sessions_new (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  source TEXT NOT NULL DEFAULT 'device' CHECK (source IN ('device', 'app')),
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id, participant_id) REFERENCES devices(id, participant_id),
  CHECK (source = 'app' OR device_id IS NOT NULL)
) STRICT;

INSERT INTO exercise_sessions_new (
  id, participant_id, device_id, source, status, created_at, ended_at, updated_at
)
SELECT
  id, participant_id, device_id, 'device', status, created_at, ended_at, updated_at
FROM exercise_sessions;
`;

const WORKOUTS_V4_SQL = `
CREATE TABLE workouts_new (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  source TEXT NOT NULL DEFAULT 'device' CHECK (source IN ('device', 'app')),
  client_id TEXT CHECK (client_id IS NULL OR length(trim(client_id)) BETWEEN 1 AND 128),
  exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL DEFAULT 'timed' CHECK (kind IN ('timed', 'reps')),
  target_duration_seconds INTEGER,
  session_id TEXT REFERENCES exercise_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT,
  target_reps INTEGER,
  phase TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'incomplete')),
  repetitions INTEGER NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds BETWEEN 0 AND 86400),
  heart_rate_bpm INTEGER CHECK (heart_rate_bpm BETWEEN 1 AND 300),
  before_bpm INTEGER CHECK (before_bpm IS NULL OR before_bpm BETWEEN 1 AND 300),
  before_bpm_at TEXT,
  after_bpm INTEGER CHECK (after_bpm IS NULL OR after_bpm BETWEEN 1 AND 300),
  after_bpm_at TEXT,
  before_skipped INTEGER NOT NULL DEFAULT 0 CHECK (before_skipped IN (0, 1)),
  after_skipped INTEGER NOT NULL DEFAULT 0 CHECK (after_skipped IN (0, 1)),
  device_status TEXT CHECK (device_status IS NULL OR device_status IN ('waiting_finger', 'reading', 'weak_signal', 'counting')),
  device_seen_at TEXT,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id, participant_id) REFERENCES devices(id, participant_id),
  CHECK (source = 'app' OR device_id IS NOT NULL),
  CHECK (
    (kind = 'timed' AND target_duration_seconds IS NOT NULL AND target_duration_seconds BETWEEN 1 AND 86400)
    OR (kind = 'reps'
      AND session_id IS NOT NULL
      AND exercise_id IS NOT NULL AND exercise_id IN ('arm_curl', 'shoulder_press', 'back_row')
      AND target_reps IS NOT NULL AND target_reps BETWEEN 1 AND 50
      AND phase IS NOT NULL AND phase IN ('before_bpm', 'counting', 'after_bpm', 'done'))
  )
) STRICT;

INSERT INTO workouts_new (
  id, participant_id, device_id, source, client_id, exercise_name, kind, target_duration_seconds,
  session_id, exercise_id, target_reps, phase, status, repetitions, elapsed_seconds,
  heart_rate_bpm, before_bpm, before_bpm_at, after_bpm, after_bpm_at,
  before_skipped, after_skipped, device_status, device_seen_at, last_sequence,
  created_at, started_at, ended_at, updated_at
)
SELECT
  id, participant_id, device_id, 'device', NULL, exercise_name, kind, target_duration_seconds,
  session_id, exercise_id, target_reps, phase, status, repetitions, elapsed_seconds,
  heart_rate_bpm, before_bpm, before_bpm_at, after_bpm, after_bpm_at,
  before_skipped, after_skipped, device_status, device_seen_at, last_sequence,
  created_at, started_at, ended_at, updated_at
FROM workouts;
`;

const INDEXES_V4_SQL = `
CREATE UNIQUE INDEX idx_sessions_active
  ON exercise_sessions(participant_id) WHERE status = 'active';
CREATE UNIQUE INDEX idx_workouts_device_open
  ON workouts(device_id) WHERE device_id IS NOT NULL AND status IN ('pending', 'active');
CREATE INDEX idx_workouts_participant_created
  ON workouts(participant_id, created_at DESC);
CREATE INDEX idx_workouts_session
  ON workouts(session_id, created_at);
CREATE UNIQUE INDEX idx_workouts_participant_client
  ON workouts(participant_id, client_id) WHERE client_id IS NOT NULL;
`;

async function toVersion4(db) {
  await db.exec(SESSIONS_V4_SQL);
  await db.exec(WORKOUTS_V4_SQL);
  await db.exec('DROP TABLE workouts');
  await db.exec('ALTER TABLE workouts_new RENAME TO workouts');
  await db.exec('DROP TABLE exercise_sessions');
  await db.exec('ALTER TABLE exercise_sessions_new RENAME TO exercise_sessions');
  await db.exec(INDEXES_V4_SQL);
}

const MIGRATIONS = [
  { version: 2, up: toVersion2 },
  { version: 3, up: toVersion3 },
  { version: 4, up: toVersion4 },
];

async function currentVersion(db) {
  await db.exec(SCHEMA_MIGRATIONS_SQL);
  const row = await db.get('SELECT MAX(version) AS v FROM schema_migrations');
  let version = Number(row?.v ?? 0);
  if (!db.isRemote) {
    const pragmaRow = await db.get('PRAGMA user_version');
    version = Math.max(version, Number(pragmaRow?.user_version ?? 0));
  }
  if (version > 0) return version;
  const hasUsers = await db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  return hasUsers ? 1 : 0;
}

// `target` is only lowered by tests that need a database at an older version.
export async function migrate(db, target = LATEST_VERSION) {
  let version = await currentVersion(db);
  if (version >= target) return;

  // Fresh database fast path: initialize straight to v4 without table rebuilds
  // and without writing PRAGMA user_version (which is read-only on Turso Cloud).
  if (version === 0 && target === LATEST_VERSION) {
    await db.transaction(async tx => {
      for (const stmt of SCHEMA_V4_STATEMENTS) {
        await tx.run(stmt);
      }
      for (let v = 1; v <= LATEST_VERSION; v += 1) {
        await tx.run('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)', v);
      }
    });
    if (!db.isRemote) {
      await db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
    }
    return;
  }

  if (version === 0) {
    await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    await db.run('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)');
    if (!db.isRemote) await db.exec('PRAGMA user_version = 1');
    version = 1;
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= version || migration.version > target) continue;
    // Table rebuilds need foreign keys off, or dropping workouts would cascade into its readings.
    // The pragma is a no-op inside a transaction, so it is set around BEGIN/COMMIT.
    await db.exec('PRAGMA foreign_keys = OFF');
    try {
      await db.exec('BEGIN');
      try {
        await migration.up(db);
        const violations = await db.all('PRAGMA foreign_key_check');
        if (violations.length > 0) {
          throw new Error(`Migration to version ${migration.version} left foreign key violations`);
        }
        await db.run('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)', migration.version);
        if (!db.isRemote) await db.exec(`PRAGMA user_version = ${migration.version}`);
        await db.exec('COMMIT');
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      await db.exec('PRAGMA foreign_keys = ON');
    }
    version = migration.version;
  }
}

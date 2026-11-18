export const LATEST_VERSION = 2;

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

function toVersion2(db) {
  db.exec(SESSIONS_SQL);
  db.exec(WORKOUTS_NEW_SQL);
  db.exec(COPY_WORKOUTS_SQL);
  db.exec('DROP TABLE workouts');
  db.exec('ALTER TABLE workouts_new RENAME TO workouts');
  db.exec(INDEXES_SQL);
  db.exec(EVENTS_SQL);
}

const MIGRATIONS = [{ version: 2, up: toVersion2 }];

function currentVersion(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version > 0) return version;
  const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  return hasUsers ? 1 : 0;
}

export function migrate(db) {
  let version = currentVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    // Table rebuilds need foreign keys off, or dropping workouts would cascade into its readings.
    // The pragma is a no-op inside a transaction, so it is set around BEGIN/COMMIT.
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      try {
        migration.up(db);
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length > 0) throw new Error(`Migration to version ${migration.version} left foreign key violations`);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    version = migration.version;
  }
}

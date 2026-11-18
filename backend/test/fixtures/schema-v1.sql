CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('participant', 'staff')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS staff_participants (
  staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, participant_id),
  CHECK (staff_id <> participant_id)
) STRICT;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  UNIQUE (id, participant_id)
) STRICT;

CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) BETWEEN 1 AND 80),
  target_duration_seconds INTEGER NOT NULL CHECK (target_duration_seconds BETWEEN 1 AND 86400),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  repetitions INTEGER NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds BETWEEN 0 AND 86400),
  heart_rate_bpm INTEGER CHECK (heart_rate_bpm BETWEEN 1 AND 300),
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id, participant_id) REFERENCES devices(id, participant_id)
) STRICT;

CREATE TABLE IF NOT EXISTS workout_readings (
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  repetitions INTEGER NOT NULL CHECK (repetitions >= 0),
  elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds BETWEEN 0 AND 86400),
  heart_rate_bpm INTEGER CHECK (heart_rate_bpm BETWEEN 1 AND 300),
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  received_at TEXT NOT NULL,
  PRIMARY KEY (workout_id, sequence)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_device_open
  ON workouts(device_id) WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_workouts_participant_created
  ON workouts(participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_participants_participant
  ON staff_participants(participant_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions(user_id);

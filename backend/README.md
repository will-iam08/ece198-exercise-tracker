# MotionTrack backend

Local Node.js 24 + Express 5 + SQLite backend for MotionTrack. A patient starts an exercise **session** on the
website and picks exercises one at a time (Arm Curl, Shoulder Press, Back Row) with a target number of reps.
The ESP32 takes a heart-rate (BPM) check-in before the set, counts reps up to the target, then takes a check-in
after it, and uploads each step over Wi-Fi. An assigned doctor reviews the patient's sessions.

The website says "patient" and "doctor". In the API, CLI and database those accounts have the roles
`participant` and `staff`; this document uses the API names where it describes routes and fields.

Contents: [1 API](#1-api-endpoints) · [2 Device protocol](#2-device-protocol) · [3 Database schema and migration](#3-database-schema-and-migration) · [4 Setup](#4-setup)

## 1) API endpoints

Base URL: `http://127.0.0.1:3000`. Requests and responses are JSON, except successful logout and device
revocation (204, no body). Send `Content-Type: application/json` with JSON bodies (at most 16 kB). Timestamps are
server-generated UTC ISO 8601 strings. Unknown body fields and unknown query parameters are rejected with 400.

Credentials:

- **Public:** none.
- **User:** `Authorization: Bearer <token>` returned by registration or login. Tokens expire after 24 hours.
- **Participant:** a user token whose account role is `participant` (a patient).
- **Staff:** a user token whose role is `staff` (a doctor). Reading a participant's records also needs an assignment; without one the route answers **404**, the same as for a record that does not exist.
- **Device:** `Authorization: Bearer <device_token>`, returned once when a participant adds a device. It works only on the two `/api/device/...` routes.

### Objects

User `U` (the password hash is never returned):

```json
{"id":"user-uuid","name":"Demo patient","email":"patient@example.com","role":"participant","created_at":"2026-11-18T15:00:00.000Z"}
```

Device `D`:

```json
{"id":"device-uuid","name":"Wrist ESP32","created_at":"2026-11-18T15:01:00.000Z","last_seen_at":null}
```

Session `S`: `workouts` lists only the session's rep exercises, oldest first.

```json
{"id":"session-uuid","participant_id":"user-uuid","device_id":"device-uuid","status":"active",
 "created_at":"2026-11-18T15:02:00.000Z","ended_at":null,"updated_at":"2026-11-18T15:02:00.000Z","workouts":[W]}
```

Exercise (workout) `W`. This is a finished Arm Curl; every column of the `workouts` table is returned:

```json
{
  "id":"workout-uuid","participant_id":"user-uuid","device_id":"device-uuid",
  "exercise_name":"Arm Curl","kind":"reps","target_duration_seconds":null,
  "session_id":"session-uuid","exercise_id":"arm_curl","target_reps":10,"phase":"done","status":"completed",
  "repetitions":10,"elapsed_seconds":0,"heart_rate_bpm":null,
  "before_bpm":78,"before_bpm_at":"2026-11-18T15:02:12.000Z","after_bpm":104,"after_bpm_at":"2026-11-18T15:02:30.000Z",
  "before_skipped":0,"after_skipped":0,"device_status":"counting","device_seen_at":"2026-11-18T15:02:30.000Z",
  "last_sequence":15,"created_at":"2026-11-18T15:02:05.000Z","started_at":"2026-11-18T15:02:12.000Z",
  "ended_at":"2026-11-18T15:02:30.000Z","updated_at":"2026-11-18T15:02:30.000Z"
}
```

A missing check-in is `null`, never 0. `*_skipped` is 0 or 1. Old workouts from before MotionTrack have
`kind:"timed"`, a `target_duration_seconds` and null rep fields (`session_id`, `exercise_id`, `target_reps`, `phase`).

Progress `P`, calculated from `completed` workouts only:

```json
{"completed_workouts":2,"total_repetitions":20,"total_duration_seconds":0,
 "daily":[{"date":"2026-11-18","exercise_name":"Arm Curl","workouts":2,"repetitions":20,"duration_seconds":0}]}
```

Dates are the UTC date of `started_at` (or `created_at` when there is none). In the tables below, `S`, `W`, `U`, `D`
and `P` stand for these objects.

### Health, exercises and accounts

| Method and route | Access | Request | Response |
| --- | --- | --- | --- |
| `GET /api/health` | Public | none | 200 `{"status":"ok"}` |
| `GET /api/exercises` | Public | none | 200 `{"exercises":[{"id":"arm_curl","name":"Arm Curl","placement":"forearm"},{"id":"shoulder_press","name":"Shoulder Press","placement":"upper arm"},{"id":"back_row","name":"Back Row","placement":"upper arm"}]}` |
| `POST /api/auth/register` | Public | `{"name","email","password"}` | 201 `{"token","expires_at","user":U}`. Always creates a `participant`. A duplicate email is 409. |
| `POST /api/auth/login` | Public | `{"email","password"}` plus optional `"portal":"patient"` or `"doctor"` | 200 `{"token","expires_at","user":U}` |
| `POST /api/auth/logout` | User | none | 204 |
| `GET /api/me` | User | none | 200 `{"user":U}` |

`portal` is the website entry point the person signed in on. If it is `doctor` and the account is not `staff`, or it
is `patient` and the account is not `participant`, the server answers **403** ("This is a patient account. Use the
patient sign-in." or the reverse) and creates no session. Any other `portal` value is 400. Omitting `portal` skips
the check. Wrong email or password is 401, with the same cost for unknown emails. Names are 1-80 characters;
emails are lowercased and unique; passwords are 12-128 characters. Registration and login share a limit of 20
attempts per IP per 15 minutes (429 with `Retry-After`).

### Devices (participant)

| Method and route | Request | Response |
| --- | --- | --- |
| `POST /api/devices` | `{"name":"Wrist ESP32"}` | 201 `{"device":D,"device_token":"d_<random>"}`. The token is shown only this once. |
| `GET /api/devices` | none | 200 `{"devices":[D]}` (not revoked) |
| `DELETE /api/devices/:id` | none | 204. Revokes the token. In one transaction its open rep exercise becomes `incomplete` (phase `done`), its open timed workout becomes `cancelled`, and its active session ends. History is kept. Unknown, someone else's or already revoked device: 404. |

### Sessions and exercises (participant)

A participant has at most one active session at a time. A session is tied to the device chosen when it starts.

| Method and route | Request | Response |
| --- | --- | --- |
| `POST /api/sessions` | `{"device_id"}` | 201 `{"session":S}`. Unknown, foreign or revoked device: 404. A session is already active: 409 with `error.session_id`. |
| `GET /api/sessions` | optional `limit` (default 10, 1-50), `offset`, `status` (`active` or `ended`) | 200 `{"sessions":[S],"limit","offset","total","server_time"}`, newest first |
| `GET /api/sessions/:id` | none (owner or assigned staff) | 200 `{"session":S,"server_time"}` |
| `POST /api/sessions/:id/exercises` | `{"exercise_id":"arm_curl","target_reps":10}` | 201 `{"workout":W}` with `status:"pending"`, `phase:"before_bpm"`. `exercise_id` is one of `arm_curl`, `shoulder_press`, `back_row`; `target_reps` is an integer 1-50. 409 if the session has ended, if it has an unfinished exercise ("Finish or stop the current exercise first"), or if the device has any unfinished workout. |
| `POST /api/workouts/:id/skip-reading` | none | 200 `{"workout":W}`. In phase `before_bpm` it sets `before_skipped` and moves to `counting` (the exercise can no longer complete). In phase `after_bpm` it sets `after_skipped`, ends the exercise as `incomplete` (phase `done`). Any other phase, or a timed workout: 409 with `error.phase`. |
| `POST /api/workouts/:id/cancel` | none | 200 `{"workout":W}`. This is "Stop exercise". A rep exercise becomes `incomplete`, phase `done`, keeping the data recorded so far; a legacy timed workout becomes `cancelled`. Idempotent. A `completed` workout is 409. |
| `POST /api/sessions/:id/end` | none | 200 `{"session":S}`. Ends the session; an unfinished exercise becomes `incomplete`. Idempotent. |

`skip-reading`, `cancel` and `end` work only on the caller's own records (other participants' and unknown ids are 404).

### Workout history and progress

| Method and route | Access | Response |
| --- | --- | --- |
| `GET /api/workouts` | Participant | 200 `{"workouts":[W],"limit","offset","total"}`, newest first. Optional `limit` (default 20, 1-100), `offset`, `status` (`pending`, `active`, `completed`, `cancelled`, `incomplete`), `kind` (`timed` or `reps`), `exercise_name` (exact, case-insensitive). |
| `GET /api/workouts/:id` | Owner or assigned staff | 200 `{"workout":W}` |
| `GET /api/workouts/:id/readings` | Owner or assigned staff | Legacy timed workouts only hold readings (`workout_readings`); rep exercises return an empty list. Optional `limit` (default 100, 1-1000), `offset`. 200 `{"readings":[...],"limit","offset","total"}` |
| `GET /api/progress` | Participant | 200 `P`. Optional `exercise_name` and `kind`. |

### Doctor (staff) routes

| Method and route | Response |
| --- | --- |
| `GET /api/participants` | 200 `{"participants":[U + "active_session_id"]}`: only assigned patients. `active_session_id` is the id of the patient's active session, or `null`. |
| `GET /api/participants/:id/sessions` | 200 like `GET /api/sessions` (same `limit`, `offset`, `status`). An unassigned participant is 404. |
| `GET /api/participants/:id/workouts` | 200 like `GET /api/workouts` (same filters incl. `kind`). Unassigned: 404. |
| `GET /api/participants/:id/progress` | 200 `P` (optional `exercise_name`, `kind`). Unassigned: 404. |

Staff can also read `GET /api/sessions/:id`, `GET /api/workouts/:id` and its `/readings` for assigned patients; for
anyone else those answer 404. Staff cannot create or change anything: participant-only routes return 403 for them.
Staff accounts and assignments are made with the [CLI](#doctor-accounts-and-assignments), not through the website.

### Legacy timed workouts

Before MotionTrack the API recorded fixed-duration workouts. Those routes remain so old data stays readable and the
old tests stay valid; the website no longer offers them (it only lists old workouts and lets a patient cancel one that
is still open, because an open workout blocks the device).

| Method and route | Notes |
| --- | --- |
| `POST /api/workouts` | Participant. `{"device_id","exercise_name","target_duration_seconds"}` (1-86400) creates a `kind:"timed"` workout (`pending`). 409 if the device already has an unfinished workout. |
| `POST /api/device/workouts/:id/updates` for a timed workout | Original body `{"sequence","repetitions","elapsed_seconds","heart_rate_bpm"?,"completed"?}`; response `{"workout":W,"duplicate":bool}`; stored in `workout_readings`. Cumulative values cannot decrease. The firmware does not run timed workouts. |

### Errors

All errors look like `{"error":{"message":"Workout not found"}}`. Some 409s add fields such as `phase` or `session_id`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid, missing or unknown input; malformed JSON; invalid query |
| 401 | Missing, expired or revoked token; wrong email or password |
| 403 | Wrong role, wrong sign-in entry point (`portal`), or browser origin not allowed |
| 404 | Route, record or participant missing or not accessible to the caller |
| 409 | Duplicate email; state conflict (active session, unfinished exercise or device workout, ended record, wrong phase); upload conflict |
| 413 | JSON body over 16 kB |
| 429 | Authentication throttle |
| 500 | Unexpected error (details are not returned) |

## 2) Device protocol

Routes use the device token. Every authenticated request also updates the device's `last_seen_at`.

**Poll.** `GET /api/device/workout` returns `{"workout":W}` for the device's single pending/active workout, or
`{"workout":null}`. The firmware polls about once a second. Each poll sets that workout's `device_seen_at`. The
fields the device uses are `id`, `kind`, `exercise_id`, `exercise_name`, `target_reps`, `phase`, `repetitions`,
`last_sequence` and `status`. A `kind:"timed"` workout is left over from before MotionTrack and is not run.

**Upload.** `POST /api/device/workouts/:id/updates` with one of four bodies. `sequence` is an integer 1 to
2147483647 that must be larger than the workout's `last_sequence`.

```json
{"sequence":1,"event":"status","capture_status":"waiting_finger"}
{"sequence":2,"event":"before_bpm","bpm":78}
{"sequence":3,"event":"progress","repetitions":1}
{"sequence":14,"event":"after_bpm","bpm":104}
```

`capture_status` is one of `waiting_finger`, `reading`, `weak_signal`, `counting`. `repetitions` is the cumulative
count (0-1000000), `bpm` an integer 1-300. Each body must contain exactly its fields.

Success is `200 {"workout":W,"duplicate":false}`. Any accepted event sets `status:"active"` and the workout's
`last_sequence`, `device_seen_at` and `updated_at`.

| Event | Allowed in phase | Effect |
| --- | --- | --- |
| `status` | `before_bpm`, `counting`, `after_bpm` | Sets `device_status` only; no phase change. |
| `before_bpm` | `before_bpm` | Saves `before_bpm` and `before_bpm_at`; phase becomes `counting`. |
| `progress` | `counting` | Saves the cumulative `repetitions` (cannot decrease or exceed `target_reps`). Reaching `target_reps` freezes the count: phase becomes `after_bpm`. |
| `after_bpm` | `after_bpm` | Saves `after_bpm` and `after_bpm_at`; phase becomes `done`; `ended_at` is set. Status is `completed` if `repetitions == target_reps` and a before reading exists (any BPM values, lower or equal is fine), otherwise `incomplete` (for example the before reading was skipped). |

Phases run `before_bpm` → `counting` → `after_bpm` → `done`. The website's skip and stop actions move the phase on
without the device, so the device must follow `phase` from its poll.

Duplicate and conflict rules:

1. An upload whose `sequence` already exists is checked first, even after the exercise has ended. Identical content
   returns **200 `duplicate:true`** and changes nothing except `device_seen_at`: the count and BPM are not saved again.
   The same sequence with different content is 409.
2. A new event on an ended workout is 409 ("Workout has ended").
3. A new `sequence` not greater than `last_sequence` is 409.
4. An event not allowed in the current phase (for example `progress` after the website skipped the reading) is 409
   with `error.phase`; the device should poll again.
5. `repetitions` above the target is 400; below the stored count is 409.
6. Malformed bodies, unknown events or fields are 400; an unknown workout id, or one on another device, is 404.

Every accepted event is stored in `workout_events`, in the same transaction as the workout update. The device
resends the same bytes until it receives a 2xx or a 409.

## 3) Database schema and migration

SQLite file, `STRICT` tables, foreign keys on. Source: [`schema.sql`](./schema.sql) (version 1 base, run on every
start with `IF NOT EXISTS`) and [`migrations.js`](./migrations.js) (version 2).

**Versioning.** The database's `PRAGMA user_version` records the schema version (now 2). A new database gets the base
schema and is then migrated to 2. An existing database with `user_version` 0 that already has a `users` table is
treated as version 1. Migrations run at startup in one transaction with `PRAGMA foreign_keys = OFF` around it (so
rebuilding `workouts` does not cascade-delete `workout_readings`), then `PRAGMA foreign_key_check`, and roll back
completely if anything fails.

**What version 2 does.** It creates `exercise_sessions` and `workout_events`, and rebuilds `workouts` with new
columns by copying every row. Every existing workout is kept with `kind='timed'`; its readings in
`workout_readings` are untouched. Nothing is deleted.

| Table | Purpose |
| --- | --- |
| `users` | Accounts; `role` is `participant` or `staff`. Passwords are scrypt hashes. |
| `auth_sessions` | Hashed user tokens with expiry. (Not exercise sessions.) |
| `staff_participants` | Doctor-to-patient assignments (many to many). |
| `devices` | One row per ESP32 per participant; only a SHA-256 hash of the device token; `revoked_at` keeps history. |
| `exercise_sessions` | `id`, `participant_id`, `device_id`, `status` (`active`/`ended`), `created_at`, `ended_at`, `updated_at`. A partial unique index allows one `active` session per participant. |
| `workouts` | One row per exercise (and per legacy timed workout). Columns below. |
| `workout_events` | Upload log for rep exercises: `workout_id`, `sequence`, `type` (`status`/`before_bpm`/`progress`/`after_bpm`), `repetitions`, `bpm`, `capture_status`, `received_at`; primary key (`workout_id`, `sequence`), which enforces the duplicate rule. |
| `workout_readings` | Legacy per-upload log for timed workouts. |

`workouts` columns: the original `id`, `participant_id`, `device_id`, `exercise_name`, `status`, `repetitions`,
`elapsed_seconds`, `heart_rate_bpm`, `last_sequence`, `created_at`, `started_at`, `ended_at`, `updated_at`, and the
version 2 additions `kind` (`timed`/`reps`), `target_duration_seconds` (now nullable), `session_id`, `exercise_id`,
`target_reps` (1-50), `phase`, `before_bpm`, `before_bpm_at`, `after_bpm`, `after_bpm_at`, `before_skipped`,
`after_skipped`, `device_status`, `device_seen_at`. `status` allows `pending`, `active`, `completed`,
`cancelled` (legacy) and `incomplete`. A CHECK requires timed rows to have a duration and rep rows to have a session,
an exercise, a target and a phase. The partial unique index on `device_id` allows one pending/active workout per
device. No raw sensor data is stored, and no API deletes accounts or workouts.

## 4) Setup

Requires **Node.js 24 or newer** and npm. Express is the only dependency; SQLite, hashing and the test runner are
built into Node. Node may print an experimental-SQLite warning; it is harmless.

```bash
cd backend
npm ci
cp .env.example .env
npm start
```

In another terminal:

```bash
curl http://127.0.0.1:3000/api/health
```

The database and its folder are created on first start and survive restarts. Local data, `.env` and `node_modules`
are git-ignored.

### Tests

```bash
cd backend
npm test
```

The tests use real HTTP requests against temporary servers and databases (including migration of a version 1
database); they never touch your own database.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface to listen on. Use `0.0.0.0` so an ESP32 on the same Wi-Fi can reach it. |
| `PORT` | `3000` | TCP port, 1-65535. |
| `DATABASE_PATH` | `./data/ece198.sqlite` | SQLite file, relative to the working directory. Use the same value for the server and the CLI. |
| `CORS_ORIGIN` | `http://localhost:5173` | One exact browser origin, no trailing slash. Other browser origins get 403. Requests with no `Origin` header (ESP32, curl) are unaffected. |
| `STAFF_PASSWORD` | none | Used only by `create-staff` (12-128 characters). Do not store it in `.env`. |

`npm start` and `npm run manage` read `.env` if it exists.

### Doctor accounts and assignments

There is no doctor registration on the website. A patient registers on the website first; then, from `backend/`:

```bash
export STAFF_PASSWORD='choose-a-long-password'
npm run manage -- create-staff doctor@example.com "Dr Demo"
unset STAFF_PASSWORD
npm run manage -- assign doctor@example.com patient@example.com
```

Remove an assignment:

```bash
npm run manage -- unassign doctor@example.com patient@example.com
```

The commands work while the server is running and print JSON. `create-staff` refuses an email that already has an
account (it never promotes one); `assign` and `unassign` require an existing `staff` email and an existing
`participant` email, and are idempotent. Command usage: `create-staff EMAIL NAME`, `assign STAFF_EMAIL PARTICIPANT_EMAIL`,
`unassign STAFF_EMAIL PARTICIPANT_EMAIL`.

### Real ESP32

Set `HOST=0.0.0.0` in `.env`, restart, and point the firmware's `API_BASE_URL` at `http://<laptop LAN IP>:3000`
(`localhost` on the ESP32 is the ESP32). The laptop firewall must allow the port. See [../firmware/README.md](../firmware/README.md)
and [../docs/demo.md](../docs/demo.md).

### Scope

HTTP with a single SQLite process, for a local course prototype. Deployment, TLS, password recovery, sensor
calibration, medical interpretation of BPM and a real data-retention policy are out of scope. Use synthetic data.

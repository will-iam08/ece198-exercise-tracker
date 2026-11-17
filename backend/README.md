# ECE 198 exercise backend

Local Node.js 24 + Express + SQLite backend for the ESP32 exercise tracker. Participants register, choose an exercise and planned duration, and review live progress and past workouts. Staff can read only their assigned participants' records. The ESP32 authenticates separately and uploads cumulative counts, elapsed time, and heart rate over Wi-Fi.

## 1) API Endpoints

Base URL: `http://127.0.0.1:3000`. Requests and responses use JSON, except successful logout and device revocation (204, no body). Send `Content-Type: application/json` with JSON bodies. All timestamps are server-generated UTC ISO 8601 strings. IDs below are illustrative; use the UUIDs returned by the API.

Authentication:

- **Public:** no credential.
- **User:** `Authorization: Bearer <token>` returned by registration/login. Sessions expire after 24 hours. Staff log in at the same endpoint.
- **Participant:** a user token whose account role is `participant`.
- **Staff:** a user token whose role is `staff`; records additionally require a staff-participant assignment.
- **Device:** `Authorization: Bearer <device_token>` returned once when a participant creates a device. It only works on the two device routes.

### Response examples used below

`U` is a public user object. Password hashes and credential hashes are never returned:

```json
{"id":"participant-uuid","name":"Demo participant","email":"participant@example.com","role":"participant","created_at":"2026-11-16T15:00:00.000Z"}
```

`D` is a device:

```json
{"id":"device-uuid","name":"Wrist ESP32","created_at":"2026-11-16T15:01:00.000Z","last_seen_at":null}
```

`W` is a workout. This is an active example; new workouts have `status: "pending"`, zero counters, `last_sequence: 0`, and null start/end/heart rate. Completed workouts have `status: "completed"` and a populated `ended_at`:

```json
{
  "id":"workout-uuid",
  "participant_id":"participant-uuid",
  "device_id":"device-uuid",
  "exercise_name":"Bicep curls",
  "target_duration_seconds":120,
  "status":"active",
  "repetitions":8,
  "elapsed_seconds":30,
  "heart_rate_bpm":92,
  "last_sequence":1,
  "created_at":"2026-11-16T15:02:00.000Z",
  "started_at":"2026-11-16T15:02:01.000Z",
  "ended_at":null,
  "updated_at":"2026-11-16T15:02:01.000Z"
}
```

`R` is one stored reading. Missing heart rate is recorded as null, not zero. `completed` is stored/returned as SQLite integer 0 or 1, while the upload accepts a JSON boolean:

```json
{"workout_id":"workout-uuid","sequence":1,"repetitions":8,"elapsed_seconds":30,"heart_rate_bpm":92,"completed":0,"received_at":"2026-11-16T15:02:01.000Z"}
```

`P` is a progress response, calculated from completed workouts only. Dates use the UTC date on which the server first received a reading:

```json
{
  "completed_workouts":1,
  "total_repetitions":25,
  "total_duration_seconds":120,
  "daily":[{"date":"2026-11-16","exercise_name":"Bicep curls","workouts":1,"repetitions":25,"duration_seconds":120}]
}
```

In the tables, substitute the complete JSON example for `U`, `D`, `W`, `R`, or `P`; these letters are documentation shorthand, not literal API values.

### Health, exercises, and accounts

| Method and route | Access / purpose | Request | Example response |
| --- | --- | --- | --- |
| `GET /api/health` | Public; confirms server and database are reachable | None | 200 `{"status":"ok"}` |
| `GET /api/exercises` | Public; supplies three exercise suggestions | None | 200 `{"exercises":["Bicep curls","Squats","Arm raises"]}` |
| `POST /api/auth/register` | Public; creates a participant and signs them in | `{"name":"Demo participant","email":"participant@example.com","password":"your-unique-password"}` | 201 `{"token":"u_<random>","expires_at":"2026-11-17T15:00:00.000Z","user":U}` |
| `POST /api/auth/login` | Public; signs in an existing participant or staff member | `{"email":"participant@example.com","password":"your-unique-password"}` | 200 `{"token":"u_<random>","expires_at":"2026-11-17T15:00:00.000Z","user":U}` |
| `POST /api/auth/logout` | User; revokes the current session | No body | 204, no body |
| `GET /api/me` | User; returns the signed-in account | None | 200 `{"user":U}` |

Names must contain 1-80 trimmed characters; emails are normalized to lowercase and unique without regard to case. Passwords must contain 12-128 characters. Registration cannot choose a role. Unknown body fields are rejected. Registration and login together allow 20 requests per IP per 15 minutes, returning 429 and `Retry-After` when exceeded.

### Device setup and participant workouts

| Method and route | Access / purpose | Request | Example response |
| --- | --- | --- | --- |
| `POST /api/devices` | Participant; provisions a credential for their ESP32 | `{"name":"Wrist ESP32"}` | 201 `{"device":D,"device_token":"d_<random>"}` |
| `GET /api/devices` | Participant; lists their unrevoked devices | None | 200 `{"devices":[D]}` |
| `DELETE /api/devices/:id` | Participant owner; revokes a device and cancels its pending/active workout; retains history | Path: device UUID; no body | 204, no body |
| `POST /api/workouts` | Participant; chooses an exercise, planned duration, and their device | `{"device_id":"device-uuid","exercise_name":"Bicep curls","target_duration_seconds":120}` | 201 `{"workout":W}` with pending state |
| `GET /api/workouts` | Participant; their paginated history, including live workouts | Optional query: `limit` (default 20, 1-100), `offset` (default 0), `status` (`pending`, `active`, `completed`, `cancelled`), `exercise_name` (exact match ignoring case) | 200 `{"workouts":[W],"limit":20,"offset":0,"total":1}` |
| `GET /api/workouts/:id` | Owner or assigned staff; current workout snapshot for live display | Path: workout UUID | 200 `{"workout":W}` |
| `GET /api/workouts/:id/readings` | Owner or assigned staff; heart-rate and count history in sequence order | Path: workout UUID; optional `limit` (default 100, 1-1000), `offset` (default 0) | 200 `{"readings":[R],"limit":100,"offset":0,"total":1}` |
| `POST /api/workouts/:id/cancel` | Participant owner; ends a pending/active workout so a new one can be selected | Path: workout UUID; no body | 200 `{"workout":W}` with `status:"cancelled"` and an end timestamp |
| `GET /api/progress` | Participant; totals and daily progress from completed workouts | Optional `exercise_name` query, exact match ignoring case | 200 `P` |

Custom exercises use the same `exercise_name` field as presets (1-80 trimmed characters); no exercise-creation endpoint is needed. Preset names are normalized to the displayed spelling. Planned duration is an integer from 1 to 86400 seconds. A device can have one pending/active workout at a time. Selecting another before completion/cancellation returns 409. History is newest first, with UUIDs breaking timestamp ties; paginate with `offset`. Offsets must be integers from 0 to 1000000000.

The website can poll `GET /api/workouts/:id` and its `/readings` route about once a second while active. For readings, advance `offset` by the number of samples received. `heart_rate_bpm` on a workout is the latest **non-null** measurement; check `updated_at` and the readings' `received_at` timestamps for freshness. A null upload keeps that snapshot value but saves a null in the individual reading. There is no generated heart-rate value when the sensor has no measurement.

Cancellation is idempotent. Completed workouts cannot be cancelled. Cancelled workouts and their readings remain in history, but are excluded from progress totals. Revoked devices stay in the database to preserve workout relationships; they disappear from the active-device list and their old tokens stop working.

### Assigned staff monitoring

| Method and route | Access / purpose | Request | Example response |
| --- | --- | --- | --- |
| `GET /api/participants` | Staff; lists only their assigned participants | None | 200 `{"participants":[U]}` |
| `GET /api/participants/:id/workouts` | Assigned staff; reviews that participant's history and live sessions | Path: participant UUID; same optional queries as `GET /api/workouts` | 200 `{"workouts":[W],"limit":20,"offset":0,"total":1}` |
| `GET /api/participants/:id/progress` | Assigned staff; reviews that participant's progress | Path: participant UUID; optional `exercise_name` | 200 `P` |

Staff can also use the shared workout detail/readings routes above. They cannot create participant workouts or devices. Staff accounts and assignments are managed by the local CLI, not public registration.

### ESP32 Wi-Fi routes

| Method and route | Access / purpose | Request | Example response |
| --- | --- | --- | --- |
| `GET /api/device/workout` | Device; retrieves its selected pending/active workout, including exercise and target time | Device Bearer token; no body | 200 `{"workout":W}` or `{"workout":null}` when no workout awaits the device |
| `POST /api/device/workouts/:id/updates` | Device; uploads live progress or the final result | Path: workout UUID. `{"sequence":1,"repetitions":8,"elapsed_seconds":30,"heart_rate_bpm":92,"completed":false}` | 200 `{"workout":W,"duplicate":false}`; exact retry returns `duplicate:true` |

Upload rules:

1. Sequence starts at 1 for each workout and increases. Gaps are allowed; an unseen older sequence is rejected. Do not reset sequence on reconnect.
2. `repetitions` is the cumulative nonnegative count (integer, at most 1000000), not a count to add. `elapsed_seconds` is cumulative actual duration, integer 0-86400. Neither may decrease.
3. `heart_rate_bpm` is optional or null when unavailable, otherwise an integer 1-300. The server stores it as reported; it does not infer sensor accuracy or interpret it medically.
4. `completed` is an optional JSON boolean, default false. Set it true in the final upload. The target duration is a user goal, not a server-enforced cutoff; the device's stop button/timer ends the workout.
5. Resend the **identical** sequence/body after a timeout. Exactly matching retries do not add samples, including retries after completion. Reusing a sequence with different values returns 409. New uploads after completion or cancellation return 409.
6. Uploads update the workout and insert the reading in a single transaction. When no app workout is selected, no records are created automatically. Revocation/cancellation requires the device to poll again and stop uploading to the old workout.

`started_at` is when the first upload arrives, not a device-clock timestamp. `ended_at` is when the server accepts the final upload or cancellation. Use `elapsed_seconds` as measured by the ESP32 for exercise duration; intermittent Wi-Fi can delay the server timestamps. The ESP32 should buffer and retry unsent data, send pending samples in sequence order, and persist the selected workout ID/next sequence if it needs to survive a reboot.

### Errors

All errors have the shape `{"error":{"message":"Workout not found"}}`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid/missing/unknown input, malformed JSON, invalid query |
| 401 | Missing, expired, revoked, or wrong kind of token; wrong login |
| 403 | Wrong user role or browser origin |
| 404 | Route missing, record missing, or record outside the caller's permissions |
| 409 | Email already registered, unfinished device workout, conflicting/reordered upload, or terminal workout |
| 413 | JSON body larger than 16kb |
| 429 | Authentication throttle exceeded |
| 500 | Unexpected server error; details are not returned to clients |

## 2) Database Schema

Source: [`schema.sql`](./schema.sql). SQLite creates the six `STRICT` tables automatically on startup. UUIDs and hashes are `TEXT`; counters and durations are `INTEGER`; times are UTC ISO `TEXT`. Every field is required unless explicitly nullable. No raw accelerometer data is stored.

| Table | Fields and types | Relationships / purpose |
| --- | --- | --- |
| `users` | `id TEXT PK`; `name TEXT`; `email TEXT UNIQUE COLLATE NOCASE`; `password_hash TEXT`; `role TEXT` (`participant` or `staff`); `created_at TEXT` | Shared accounts; passwords use a per-password random salt and asynchronous scrypt. Public responses omit the hash. |
| `auth_sessions` | `token_hash TEXT PK`; `user_id TEXT FK`; `created_at TEXT`; `expires_at TEXT` | Many sessions per user. Only SHA-256 token hashes are stored. Deleting a user cascades sessions. |
| `staff_participants` | `staff_id TEXT FK`; `participant_id TEXT FK`; composite PK (`staff_id`, `participant_id`) | Many-to-many staff assignments. Both reference `users.id`; CLI validates their respective roles. User deletion cascades assignments. |
| `devices` | `id TEXT PK`; `participant_id TEXT FK`; `name TEXT`; `token_hash TEXT UNIQUE`; `created_at TEXT`; nullable `last_seen_at TEXT`, `revoked_at TEXT`; unique (`id`, `participant_id`) | Each device belongs to one participant. Only a hash of its credential is stored. Revocation retains the row and history. |
| `workouts` | `id TEXT PK`; `participant_id TEXT FK`; `device_id TEXT`; `exercise_name TEXT`; `target_duration_seconds INTEGER`; `status TEXT`; `repetitions INTEGER DEFAULT 0`; `elapsed_seconds INTEGER DEFAULT 0`; nullable `heart_rate_bpm INTEGER`; `last_sequence INTEGER DEFAULT 0`; `created_at TEXT`; nullable `started_at TEXT`, `ended_at TEXT`; `updated_at TEXT` | Many workouts per participant/device. Composite FK (`device_id`, `participant_id`) enforces device ownership. Counters reflect the latest accepted upload; heart rate is the latest non-null sample. |
| `workout_readings` | `workout_id TEXT FK`; `sequence INTEGER`; `repetitions INTEGER`; `elapsed_seconds INTEGER`; nullable `heart_rate_bpm INTEGER`; `completed INTEGER` (0 or 1); `received_at TEXT`; composite PK (`workout_id`, `sequence`) | Many samples per workout, including the final sample. Composite key prevents duplicate uploads. Workout deletion cascades readings. |

Constraints enforce nonempty names/exercises, the four allowed workout statuses, nonnegative counters, duration bounds, positive sequence numbers, and heart rate 1-300 when present. A partial unique index allows one unfinished workout per device. History and assignment lookups are indexed. Foreign keys are enabled on every connection. Device deletion is restricted by workout references; the API revokes credentials instead of deleting device rows. No HTTP API deletes account/workout data. Prototype records are retained until the database owner deliberately removes them; no automatic retention/deletion policy has been assumed.

## 3) Setup Instructions

### Dependencies and local start

Install **Node.js 24 or newer** and npm. Express 5 is the only direct package dependency; SQLite, hashing, and the test runner use Node's built-in modules. The package lock records exact dependency versions. No separate database server or paid service is required. Runtime APIs were checked against the official [Express documentation](https://expressjs.com/en/starter/installing/) and [Node crypto documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html); [Node SQLite documentation](https://nodejs.org/api/sqlite.html) describes the embedded driver.

From the cloned repository root:

```sh
cd backend
npm ci
cp .env.example .env
npm start
```

In another terminal:

```sh
curl http://127.0.0.1:3000/api/health
npm test
```

Run npm commands from this backend directory. The database and its parent directory are created on first start, and existing records survive restarts. Local data, credentials in `.env`, and installed packages are ignored by Git. Node 24 may print an experimental SQLite warning; this does not prevent execution.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface on which the API listens. Use `0.0.0.0` for an ESP32 on the same Wi-Fi LAN. |
| `PORT` | `3000` | TCP port, 1-65535. |
| `DATABASE_PATH` | `./data/ece198.sqlite` | Persistent SQLite file, resolved relative to the working directory. Use the same value for server and CLI. |
| `CORS_ORIGIN` | `http://localhost:5173` | One exact frontend origin, no trailing slash. Requests from other browser origins return 403. Requests without an Origin header, such as ESP32/curl requests, use token authentication normally. |
| `STAFF_PASSWORD` | None | Required only by `create-staff`; do not store it in `.env` or commit it. |

The server does not require a JWT/session signing secret: it stores hashes of random opaque credentials. Configure the frontend to send Bearer tokens and clear them on logout. Keep the device token only in the ESP32's configuration; never put a user token on it.

### Provision staff and assignments

Register the participant through the API first. To create a staff account, enter a unique password using a hidden shell prompt (macOS zsh):

```sh
read -rs 'STAFF_PASSWORD?New staff password (12-128 characters): '
echo
export STAFF_PASSWORD
npm run manage -- create-staff staff@example.com "Exercise staff"
unset STAFF_PASSWORD
npm run manage -- assign staff@example.com participant@example.com
```

Remove an assignment with:

```sh
npm run manage -- unassign staff@example.com participant@example.com
```

These commands can run while the local server is running. They validate roles and never promote an existing participant account. Assignment/unassignment is idempotent. Staff log in through `POST /api/auth/login`. No staff credentials are seeded in the project.

### App and ESP32 integration order

1. App registers/logs in the participant and receives a user token.
2. App calls `POST /api/devices` once; save the returned device UUID and provision `device_token` onto that ESP32. The API will not reveal the token again; revoke and create a replacement if lost.
3. App fetches `/api/exercises` or accepts a custom exercise, collects planned seconds, then calls `POST /api/workouts` with the device UUID.
4. ESP32 calls `GET /api/device/workout` using its device token, gets the workout UUID and selected exercise/time, and starts counting when the participant presses its physical start button.
5. ESP32 calls the updates endpoint roughly once a second with cumulative counters, a fresh sequence, and a heart-rate reading when available. Mark the last upload `completed:true`.
6. App polls the workout and readings; completed records appear in history and progress. Assigned staff can use their own token to view the same records.

For the actual ESP32, change `HOST=0.0.0.0` in `.env`, restart, and use the computer's LAN address, for example `http://192.168.1.10:3000/api/device/workout`. `localhost` on the ESP32 refers to the ESP32 itself. The computer and device must share a reachable network, and the OS firewall must allow the configured port. Set `CORS_ORIGIN` to the frontend's actual origin independently of the device URL.

### Verification and scope

`npm test` uses real HTTP requests against ephemeral local servers and isolated SQLite databases. It checks all listed routes, registration/login/logout/expiry, assignments and user/device isolation, custom workouts and presets, live/final uploads, heart-rate persistence, retries/reordering, cancellation/revocation, validation/CORS, and database persistence/constraints. Tests do not modify your project database or create permanent test accounts.

The implementation follows the overview's app workflow (receive counts/durations, record workouts, participant progress/history, staff monitoring with permissions, persistent storage) and the clarified requirements (Wi-Fi live uploads, registration, exercise/time input, and heart-rate history).

Remaining assumptions: "time" means planned duration, not scheduling a workout at a clock time; staff assignment is many-to-many; heart rate may be missing; device firmware calculates repetitions and decides when to stop. HTTP plus a single SQLite process is intended for the local course prototype. Browser UI, ESP32 firmware/Bluetooth, sensor calibration, deployment/TLS, password recovery/email verification, and a real participant-data retention policy are outside this backend deliverable. Use synthetic data locally; real participant deployment needs its actual privacy/access/retention requirements and secure transport specified first.

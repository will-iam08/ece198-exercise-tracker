# MotionTrack website

React + Vite frontend for the [MotionTrack backend](../backend/README.md). It has two entry points:

- **Patient:** `http://localhost:5173/` — register or sign in, add an ESP32 device, start a workout session, pick
  exercises one at a time (exercise and target reps), watch live reps and heart-rate check-ins, skip a reading,
  stop an exercise, end the session, and review History and Progress.
- **Doctor:** `http://localhost:5173/doctor` — sign in with a doctor account, see assigned patients (with a
  "Live now" badge), and open each patient's sessions and exercises. Read-only.

Signing in on the wrong entry point is refused by the server ("This is a patient account. Use the patient
sign-in." / "This is a doctor account. Use the doctor sign-in."). Internally the roles are `participant` (patient)
and `staff` (doctor); that is what the API and CLI call them.

## Requirements

- Node.js 24 or newer for the backend (the frontend itself builds on Node 22+) and npm.
- The backend running at `http://127.0.0.1:3000` with `CORS_ORIGIN=http://localhost:5173` (its default).

## Run it locally

Terminal 1, backend:

```bash
cd backend
npm ci
test -f .env || cp .env.example .env
npm start
```

Terminal 2, frontend:

```bash
cd frontend
npm ci
test -f .env.local || cp .env.example .env.local
npm run dev
```

Open **http://localhost:5173** (use `localhost`, not `127.0.0.1`: the backend only accepts that exact origin). The
dev server is pinned to that host and port and fails rather than moving to another port.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://127.0.0.1:3000` | Backend base URL (used when unset, in dev and production builds). |

Vite variables are public and end up in the browser bundle. Never put passwords or tokens in them.

### Tests and build

```bash
cd frontend
npm test
npm run build
```

`npm test` runs the unit tests (exercise status and BPM display rules, progress ranges, route detection).
`npm run build` writes the production build to `dist/`. `npm run preview` serves it at `http://localhost:5173`.

## Doctor accounts

Doctors are created and assigned with the backend CLI; there is no doctor registration on the website. The patient
must have registered first:

```bash
cd backend
export STAFF_PASSWORD='choose-a-long-password'
npm run manage -- create-staff doctor@example.com "Dr Demo"
unset STAFF_PASSWORD
npm run manage -- assign doctor@example.com patient@example.com
```

## Trying it without hardware: the fake device

`scripts/fake-device.mjs` pretends to be the ESP32 and sends **made-up** heart rates and reps to the real backend
device routes, using the same protocol as the firmware. It is a test tool only and says nothing about the real
device, its sensors or its firmware.

It works on **one exercise per run**: start the exercise on the website, then run the script with the device token
the website showed once when you added the device. It prints each step, runs before-check-in, reps, and
after-check-in, and exits when the exercise is closed (done, stopped or session ended). Run it again for the next
exercise. The token is never printed.

```bash
cd frontend
DEVICE_TOKEN='<token from My devices>' npm run fake-device -- --help
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--bpm-before N` | 78 | Heart rate sent for the check-in before the exercise (1-300). |
| `--bpm-after N` | 104 | Heart rate sent for the check-in after the exercise (1-300). |
| `--rep-ms N` | 800 | Milliseconds per repetition (50-60000). |
| `--weak-ms N` | 0 | Report "weak signal" for N ms in each check-in before it succeeds. |
| `--no-after-bpm` | off | Never finish the after-check-in: keep reporting "waiting for finger" / "weak signal" until the website's Skip reading is used (the exercise ends Incomplete). |
| `--retry-last` | off | After the first counted rep, resend that upload byte for byte and print the server's reply (`duplicate`); the count does not change. |

`API_BASE_URL` (environment variable) overrides the backend address (default `http://127.0.0.1:3000`).

Example runs, one per exercise. Start the matching exercise on the website first (with a target of 5 reps, say):

```bash
# Arm Curl: normal run
DEVICE_TOKEN='<token>' npm run fake-device -- --rep-ms 600
```

```bash
# Shoulder Press: first check-in is weak for 3 s before it succeeds
DEVICE_TOKEN='<token>' npm run fake-device -- --weak-ms 3000 --bpm-before 82 --bpm-after 110
```

```bash
# Back Row: demonstrate a retried upload that must not double-count
DEVICE_TOKEN='<token>' npm run fake-device -- --retry-last
```

```bash
# Any exercise: never take the after reading; press "Skip reading" on the website to end it Incomplete
DEVICE_TOKEN='<token>' npm run fake-device -- --no-after-bpm
```

The full course demo is in [../docs/demo.md](../docs/demo.md).

## How the website behaves

- **Sign-in.** The account token is kept in memory only; reloading signs you out. Sign-out revokes the session on
  the server and any 401 returns to the sign-in screen.
- **Device tokens** are shown once, kept only while that panel is open, and never stored or logged by the site.
- **Live exercise.** The open exercise is refreshed about once a second in a single awaited loop (never
  overlapping); lists refresh about every 5 seconds. Failures back off (1, 2, 4, 8, then 10 s) and the page marks
  itself as disconnected from the server while it keeps the last data. If the device has not contacted the server for more than
  5 seconds while an exercise is open, the page shows "Device not responding".
- **Heart rate** is only the before and after check-in values with their capture times. A missing value shows as
  "No reading" (or "Skipped" when the patient skipped it), never as 0 and never estimated.
- **Status.** An exercise is **Complete** only when all target reps were counted and both check-ins exist.
  Otherwise it ends **Incomplete** (skipped or missing reading, stopped exercise, or session ended early).
- **Progress** counts completed exercises and reps only, over a selectable range.
- **Doctor view** uses the same polling for a live session and is read-only; an unassigned patient is not
  reachable (the API answers 404).

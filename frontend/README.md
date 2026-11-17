# ECE 198 exercise tracker — website

React + Vite frontend for the backend in [`../backend`](../backend/README.md). Participants register, add an
ESP32 device, set up a workout, watch live repetitions / time / heart rate, and review history and progress.
Staff sign in through the same form and get a read-only dashboard of their assigned participants.

## Requirements

- Node.js 24 or newer for the backend (the frontend itself builds on Node 22+), and npm.
- The backend running at `http://127.0.0.1:3000` with `CORS_ORIGIN=http://localhost:5173` (its default).

## Run it locally

Terminal 1 — backend:

```sh
cd backend
npm ci
test -f .env || cp .env.example .env
npm start
```

Terminal 2 — frontend:

```sh
cd frontend
npm ci
test -f .env.local || cp .env.example .env.local
npm run dev
```

Open **http://localhost:5173** (use `localhost`, not `127.0.0.1`: the backend only accepts that exact origin).
The dev server is pinned to that host and port and fails rather than moving to another port.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://127.0.0.1:3000` | Backend base URL. Used when the variable is unset, in both dev and production builds. |

Vite variables are public and end up in the browser bundle. Never put passwords or tokens in them.

### Other commands

```sh
npm run build     # production build into dist/
npm run preview   # serve the production build at http://localhost:5173
npm test          # unit tests (minutes conversion, heart-rate freshness, progress ranges)
```

## Staff accounts

Staff are created and assigned with the backend CLI (there is no staff registration on the website):

```sh
cd backend
read -rs 'STAFF_PASSWORD?New staff password (12-128 characters): '; echo; export STAFF_PASSWORD
npm run manage -- create-staff staff@example.com "Exercise staff"
unset STAFF_PASSWORD
npm run manage -- assign staff@example.com participant@example.com
```

## Checking the site without hardware

`scripts/fake-device.mjs` pretends to be the ESP32 and sends **made-up numbers** to the real backend device
routes. It is for testing only, is not part of the website, and says nothing about the real device or sensors.

```sh
cd frontend
DEVICE_TOKEN='<token the website showed when you added the device>' npm run fake-device -- --seconds 30
```

Options: `--seconds N`, `--no-heart-rate`, `--drop-heart-rate N` (heart rate for the first N updates only),
`--pause N` (stop sending for N seconds midway), `--no-complete` (never send the final upload).

### Manual checklist

Each step passes only if the stated result appears.

| # | Do this | Passes when |
| --- | --- | --- |
| 1 | Create an account (password of 12+ characters) | You are signed in and see Workout / My devices / History / Progress |
| 2 | My devices → add “Test ESP32” | A device token is shown once; after “hide token” it cannot be shown again; the device is selected |
| 3 | Workout → choose device, “Another exercise” → `Leg lifts`, `0.5` minutes → Set up workout | Screen says “Ready. Press the start button on your device”; planned time 0:30; heart rate “No reading” |
| 4 | Run the fake device with `--seconds 30 --drop-heart-rate 10 --no-complete` | Repetitions, time, and heart rate change about once a second with “Live reading” |
| 5 | Keep watching after update 10 | About 5 seconds later the heart-rate tile turns amber: “No current reading — last reading was N bpm, … ago” |
| 6 | Stop the backend for a few seconds, then start it again | “Disconnected from the server” appears, numbers stay, and updates resume without duplicated chart points |
| 7 | Cancel workout → Yes | “This workout was cancelled”; it is in History as Cancelled and not counted in Progress |
| 8 | Set up Bicep curls for 1 minute and run the fake device with `--seconds 15` | “Workout complete”; heart-rate chart and readings table are shown |
| 9 | History | All workouts listed, newest first; exercise and status filters and paging work; View details shows the chart |
| 10 | Progress | Totals for completed workouts only; changing the time range and “Show on chart” updates totals and the bar chart |
| 11 | Reload the page | You are signed out (the account token is kept in memory only); signing in returns to an unfinished workout |
| 12 | Sign out, then sign in as an assigned staff member | Only assigned participants are listed; their workouts, live view, and progress open read-only (no cancel button) |
| 13 | Sign in as a staff member with no assignments | “No participants are assigned to you yet” |

## How it behaves

- **Sign-in.** The account token is kept in memory only. Reloading or closing the page signs you out. Sign-out
  revokes the session on the server; any 401 returns to the sign-in screen and removes all account data from the page.
- **Device tokens** are shown once, held only while that panel is open, and never stored or logged by the site.
- **Polling.** The workout and its new readings are fetched about once a second in a single awaited loop
  (never overlapping), from the stored reading offset, de-duplicated by sequence. Polling stops when the workout is
  completed or cancelled, on leaving the screen, or on sign-out. Network failures back off (1, 2, 4, 8, then 10 s).
  History refreshes separately every 5 seconds.
- **Heart rate** is never shown as 0 and never estimated. States on the live screen:

  | State | When | Shown as |
  | --- | --- | --- |
  | Live | newest non-null reading reached the server ≤ **5 seconds** ago | value in bpm, green “♥ Live reading” |
  | Stale | newest non-null reading is older than 5 seconds, or the server is unreachable | amber tile, “⚠ No current reading”, with the last value and its age and time |
  | None | no heart rate has been received | grey dashed tile, “No reading” |
  | Finished | workout completed or cancelled | “Last heart rate recorded” with its date and time |

  Freshness compares the reading's server `received_at` time with this computer's clock, so the two clocks need to
  agree (they do when both run on the same machine).
- **Charts** plot only stored readings against the device's elapsed time; samples without a heart rate leave a gap.
  Every chart has a table with the same numbers.
- **Progress** uses the backend's daily totals (grouped by UTC date). “All time” shows the backend's own totals;
  shorter ranges add up the daily rows inside the range.

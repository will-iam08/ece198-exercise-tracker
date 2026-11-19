# MotionTrack

MotionTrack is a rep-counting exercise tracker for a course demo (ECE 198). A patient starts a workout session on
the website and picks exercises one at a time (Arm Curl, Shoulder Press, Back Row) with a target number of reps.
An ESP32 with a motion sensor, a pulse sensor and a small OLED takes a heart-rate check-in before the set, counts
reps up to the target, freezes, then takes a check-in after it, and uploads each step over Wi-Fi. A doctor signs in
separately and reviews their assigned patients' sessions: target, reps, before and after heart rate, times and status.
Doctors also set each patient's care plan (notes, target reps, a heart-rate range) and answer questions that patients
send from the website or by email. An admin creates doctor accounts and assigns patients to doctors.
An exercise is **Complete** only when every rep was counted and both heart-rate readings exist; otherwise it is
**Incomplete**. Retried uploads are never counted twice.

The website says "patient", "doctor" and "admin"; the API, CLI and database call those roles `participant`, `staff`
and `admin`.

For direct iPhone control over Bluetooth, use the [Motion Log app and integrated ESP32 firmware](mobile/). [Wiring and setup guide](mobile/setup-guide.md)

## Layout

```text
backend/    Node 24 + Express + SQLite API, device protocol, account CLI, email bot, tests
frontend/   React + Vite website: patient at /, doctor at /doctor, admin at /admin; synthetic test device script
firmware/   ESP32 Arduino sketch (MotionTrack/), host tests, wiring and flashing guide
mobile/     SwiftUI iPhone app, Bluetooth-enabled ESP32 firmware, wiring guide and protocol tests
docs/       user-guide.md (using the website), demo.md (setup and demo script), design/ (the approved design)
```

## Quick start (no hardware)

Needs Node.js 24+ and npm. Terminal 1:

```bash
cd backend
npm ci
test -f .env || cp .env.example .env
npm start
```

Terminal 2:

```bash
cd frontend
npm ci
test -f .env.local || cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173/` (patient), `http://localhost:5173/doctor` (doctor) or `http://localhost:5173/admin`
(admin). The
[user guide](docs/user-guide.md) explains each screen; to try it without hardware, use the synthetic test device as
described in [docs/demo.md](docs/demo.md). Run the checks with `cd backend && npm test`,
`cd frontend && npm test && npm run build` and `bash firmware/tests/run.sh`.

## Documentation

- [Using the website](docs/user-guide.md): patients, doctors, admins, and setting up accounts
- [Demo setup and script](docs/demo.md): exact steps, with the test device or the real ESP32; LAN and live-domain
  access; the email bot
- [Backend: API, device protocol, schema, migration, CLI](backend/README.md)
- [Demo accounts and Render deployment](backend/README.md#demo-accounts-and-render): the demo seed needs
  `DEMO_ADMIN_PASSWORD`, `DEMO_DOCTOR_PASSWORD` and `DEMO_PATIENT_PASSWORD` and creates nothing without them
- [Frontend: website setup, test device, behaviour](frontend/README.md)
- [Firmware: wiring, libraries, flashing, Serial commands](firmware/README.md)
- [Approved design](docs/design/2026-11-18-motiontrack-design.md)

## Status

The backend, website and test device are implemented and tested together. The firmware has been checked with host
tests on synthetic data; real Wi-Fi, rep-counting thresholds and the heart-rate check-in still need to be tested
on the hardware (see the notes in docs/demo.md).

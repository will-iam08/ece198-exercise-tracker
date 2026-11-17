# ECE 198 Exercise Tracker

An ESP32 exercise tracker backend for recording repetitions, workout duration, and heart-rate readings, with participant accounts and assigned staff monitoring.

The backend is implemented and tested. The website frontend is the next step.

- [Backend API, database schema, and setup guide](backend/README.md)
- [Frontend directions and ready-to-paste Claude prompt](FRONTEND_HANDOFF.md)

## Run the backend

Requires Node.js 24+ and npm. From the repository root:

```sh
cd backend
npm ci
cp .env.example .env
npm start
```

The API starts at `http://127.0.0.1:3000`. In another terminal, run `npm test` from `backend/`.

## Project layout

```text
backend/               API, SQLite schema, staff management CLI, and tests
FRONTEND_HANDOFF.md     Frontend requirements and integration contract
frontend/              Location for the frontend to be built next
```

The repository includes source, tests, dependency lockfile, and example configuration. Local databases, installed packages, credentials, and unrelated coursework are excluded. ESP32 firmware and a browser UI are separate from the current backend deliverable.

# ECE 198 Exercise Tracker

An ESP32 exercise tracker backend for recording repetitions, workout duration, and heart-rate readings, with participant accounts and assigned staff monitoring.

The backend and the website frontend are implemented. ESP32 firmware is separate.

- [Backend API, database schema, and setup guide](backend/README.md)
- [Frontend requirements and integration contract](FRONTEND_HANDOFF.md)
- [Frontend setup, run, and verification guide](frontend/README.md)

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
frontend/              React + Vite website (see frontend/README.md)
```

The repository includes source, tests, dependency lockfile, and example configuration. Local databases, installed packages, credentials, and unrelated coursework are excluded. ESP32 firmware and a browser UI are separate from the current backend deliverable.

# Frontend handoff for Claude

The working backend is in `backend/`. Build the website in a new sibling `frontend/` directory.
Read [the API, schema, and setup contract](backend/README.md), [implemented routes](backend/app.js), and [schema](backend/schema.sql) before coding. Backend tests run with `cd backend && npm test`.
The repository is private: `will-iam08/ece198-exercise-tracker`. Give Claude the cloned/attached project files or an authenticated repository integration; a repository URL alone may not grant access.

## Ready-to-paste prompt

> Build the frontend for this ECE 198 exercise tracker in `frontend/`, using the existing backend in `backend/`. Read `FRONTEND_HANDOFF.md` and `backend/README.md` first. React with Vite is a reasonable default; keep dependencies and UI simple.
>
> Implement participant registration/login, device setup, exercise selection, planned duration, live repetition/time/heart-rate display, workout history, and completed-workout progress. Offer Bicep curls, Squats, Arm raises, and a custom exercise name. Also implement a read-only staff dashboard for assigned participants. Use the real API in normal flows; do not generate readings, inferred repetition counts, or mock success responses.
>
> Design for older participants: large labeled controls, readable text, keyboard access, clear focus, adequate contrast, plain language, and loading/empty/error states. Keep staff screens separate by account role. Treat missing or stale heart rate honestly.
>
> Preserve the existing backend API and database contracts unless an explicit user requirement requires a change. Staff creation and assignments remain CLI operations. Hardware firmware is separate. Implement safe polling, correct token handling, and the acceptance checks below. Deliver the frontend, dependency lockfile, `.env.example`, and exact install/run instructions. Verify it against the running backend and report what was tested and what remains unverified.

## Run the two applications

Use Node.js 24 or newer. Start the backend from its own directory:

```sh
cd backend
npm ci
# Copy only when .env does not already exist:
test -f .env || cp .env.example .env
npm start
```

Keep backend `.env` set to `CORS_ORIGIN=http://localhost:5173` for this frontend origin.
Create `frontend/.env.local` containing this public configuration, and provide the same key in `frontend/.env.example`:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:3000
```

After creating the frontend and its package lock, run it from a second terminal:

```sh
cd frontend
npm ci
npm run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`. A different hostname/port is a different origin and requires changing backend `CORS_ORIGIN` and restarting it. Vite variables are public; never put passwords or tokens in them. Register participants through the website. For staff setup/assignments, follow [the CLI instructions](backend/README.md#provision-staff-and-assignments); staff log in through the normal login form.

## Screens and data flow

1. **Account:** registration sends `{name,email,password}`; login sends `{email,password}`. Both return `{token,expires_at,user}`. Password length is 12–128 characters. Registration always creates a participant; never send `role`.
2. **Device setup:** list `GET /api/devices`, allow creating one with `{name}`, and select a returned device ID. Show the newly returned `device_token` once for provisioning onto that ESP32; it cannot be retrieved later. Do not log it or persist it in frontend storage. Revocation uses `DELETE /api/devices/:id`; explain that it also cancels its unfinished workout and retains history.
3. **New workout:** fetch `GET /api/exercises`; also allow a custom name (1–80 characters). Collect planned minutes and convert to an integer number of seconds; validate the result is 1–86400. POST `{device_id,exercise_name,target_duration_seconds}` to `/api/workouts`. Use actual API IDs. A device can have only one pending/active workout; handle 409 and offer to resume or cancel it.
4. **Live workout:** use the returned workout ID to read `/api/workouts/:id`. Show exercise, planned duration, reported elapsed seconds, repetitions, heart rate, and connection freshness. A pending workout means “Ready—press the device’s start button”; creating it does not start the physical device. Offer `POST /api/workouts/:id/cancel` with no body for pending/active workouts.
5. **History/progress:** paginate `GET /api/workouts` and use `GET /api/progress`. History includes all statuses; progress includes completed workouts only. Allow exercise filtering and reading history for a selected workout.
6. **Staff:** `user.role === 'staff'` shows `GET /api/participants`; select an assigned participant, then fetch `/api/participants/:id/workouts` and `/api/participants/:id/progress`. Workout detail/readings use the same shared routes as participants. Staff cannot create devices or workouts. An empty assignment list needs a clear empty state, not a broken dashboard.

## Request and response rules

- Every protected website request uses `Authorization: Bearer <user token>`; JSON bodies also use `Content-Type: application/json`. Use returned `user.role`, and optionally `GET /api/me`, to choose screens. These are opaque tokens, not JWTs.
- Prefer keeping the user token in memory and requiring sign-in after a page reload. `sessionStorage` would preserve it across reloads but exposes it to any script running in the page; only choose that tradeoff explicitly. Clear state on logout/401. POST `/api/auth/logout` to revoke the session before clearing local state.
- Tokens expire after 24 hours; there is no refresh endpoint. A 204 response from logout/device revocation has no JSON body. Unknown JSON fields/query parameters are rejected; send only documented fields.
- Errors are `{ "error": { "message": "..." } }`. Handle 400 validation, 401 session expiry, 403 role/origin, 404 missing/inaccessible records, 409 conflicts, 413 oversized input, 429 authentication throttling, and network errors. On 429, use `Retry-After`; do not automatically retry credentials.
- Account tokens and device tokens are different credentials. The two `/api/device/...` routes are for firmware; never use a device token to sign in a person or ship it in the frontend bundle.

| Website request | Response shape / pagination |
| --- | --- |
| `GET /api/devices` | `{devices:[{id,name,created_at,last_seen_at}]}`; active credentials only |
| `POST /api/devices` | `{device:{id,name,created_at,last_seen_at},device_token}`; 201 |
| `POST /api/workouts` or `GET /api/workouts/:id` | `{workout:{id,participant_id,device_id,exercise_name,target_duration_seconds,status,repetitions,elapsed_seconds,heart_rate_bpm,last_sequence,created_at,started_at,ended_at,updated_at}}` |
| `GET /api/workouts` or staff participant history | `{workouts:[...],limit,offset,total}`; `limit` defaults 20, max 100; `offset` defaults 0; optional `status` and exact case-insensitive `exercise_name` |
| `GET /api/workouts/:id/readings` | `{readings:[{workout_id,sequence,repetitions,elapsed_seconds,heart_rate_bpm,completed,received_at}],limit,offset,total}`; default limit 100, max 1000 |
| `GET /api/progress` or staff participant progress | `{completed_workouts,total_repetitions,total_duration_seconds,daily:[{date,exercise_name,workouts,repetitions,duration_seconds}]}`; optional `exercise_name` |

Workout states are `pending`, `active`, `completed`, `cancelled`. Counters start at zero; `started_at`, `ended_at`, and heart rate can be null. Stored readings return `completed` as integer **0 or 1**; firmware uploads use JSON **false or true**. Render timestamps locally when useful, but daily progress groups use UTC dates; do not reinterpret those date-only keys through local-midnight conversion.

## Polling and heart-rate display

- Poll the selected workout and new readings about once per second. Use an awaited loop or schedule the next timeout only after the previous cycle finishes; avoid overlapping requests. Abort in-flight requests and clear timers when changing workout/account, leaving the screen, or unmounting. Prevent an old response from replacing the new selection.
- Fetch readings in ascending sequence order using `limit` and `offset`. Advance offset by the number received, not by the requested limit; fetch remaining pages when `offset < total`. Reset accumulated readings/offset on workout change and deduplicate by sequence. Refresh paginated workout history separately; new items can shift history offsets.
- On completion/cancellation, perform a final snapshot/readings refresh, stop live polling, and refresh history/progress. Back off on network errors and show disconnected/stale status without zeroing known data. A reconnect resumes from the stored reading offset.
- `workout.heart_rate_bpm` is the latest **non-null** value. A newer null sample leaves that snapshot value unchanged. Determine heart-rate freshness from the `received_at` of the latest non-null reading; `workout.updated_at` only proves that some telemetry arrived. Show “No reading” or a clearly timestamped old value when appropriate; null is never 0 bpm.
- Plot available readings without inventing values across missing samples. Use device `elapsed_seconds` for the exercise timeline. Server `started_at`/`ended_at` reflect receipt time and can be delayed by Wi-Fi. The backend does not count reps, calculate heart rate, or enforce the planned-time cutoff; the physical device’s button/timer ends the session.

## Exact fetch workflow for manual integration verification

This synthetic-data check demonstrates the existing contract. Device calls below substitute for firmware **only during this manual check**; keep them out of normal website data flows. Run equivalent code in a Vite module/browser session with the allowed origin. The sample creates a new test participant and device; the actual UI must reuse selected devices instead of provisioning on every workout.

```js
const API = import.meta.env.VITE_API_BASE_URL;
let userToken;
async function api(path, { method = 'GET', body, token = userToken, signal } = {}) {
  const response = await fetch(API + path, {
    method, signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'Request failed'), { status: response.status });
  return data;
}
const account = await api('/api/auth/register', {
  method: 'POST',
  body: { name: 'Demo participant', email: `demo-${Date.now()}@example.com`, password: 'test-only-password-123' },
});
userToken = account.token; // Keep the actual app's token in account state/memory.
const provisioned = await api('/api/devices', { method: 'POST', body: { name: 'Test ESP32' } });
const deviceToken = provisioned.device_token; // Show once for firmware provisioning; never log it.
const { workout } = await api('/api/workouts', {
  method: 'POST', body: { device_id: provisioned.device.id, exercise_name: 'Bicep curls', target_duration_seconds: 120 },
});
const selected = await api('/api/device/workout', { token: deviceToken }); // Firmware only.
const updates = `/api/device/workouts/${selected.workout.id}/updates`;
await api(updates, {
  method: 'POST', token: deviceToken,
  body: { sequence: 1, repetitions: 8, elapsed_seconds: 30, heart_rate_bpm: 92, completed: false },
});
const live = await api(`/api/workouts/${workout.id}`); // Participant display now reads active data.
await api(updates, {
  method: 'POST', token: deviceToken,
  body: { sequence: 2, repetitions: 25, elapsed_seconds: 120, heart_rate_bpm: 100, completed: true },
});
const samples = await api(`/api/workouts/${workout.id}/readings?limit=100&offset=0`);
const history = await api('/api/workouts?status=completed&limit=20&offset=0');
const progress = await api('/api/progress');
await api('/api/auth/logout', { method: 'POST' });
userToken = undefined;
```

Firmware must send cumulative counters and increasing sequences for each workout; an exact retry is safe, changing an existing sequence is not. See [the complete Wi-Fi upload rules](backend/README.md#esp32-wi-fi-routes). For real hardware, configure backend `HOST=0.0.0.0`, use the computer's LAN address on the ESP32, and keep the frontend origin configured separately. Firmware, sensors/calibration, Bluetooth, deployment, and medical interpretation are outside the frontend task.

## Acceptance checks before handing back the frontend

- Run the existing backend tests, frontend build, and frontend-specific checks; verify normal screens against this real backend with synthetic participant data.
- Register/login/logout; expired sessions return to sign-in without stale personal data. A reload follows the chosen memory-token policy. Show validation/conflict/throttle/network errors without exposing credentials.
- Provision/select a device, create each preset and a custom exercise, convert minutes correctly, recover a pending workout, handle one-workout-per-device conflicts, and cancel an unfinished workout.
- Use the manual device uploads above to verify actual live counts/time/heart rate, missing/stale heart rate, final samples, completion, history pagination, and completed-only progress. Refresh/reconnect without duplicate chart points or stacked polling loops.
- Create staff/assignments through the CLI, then verify an assigned staff member can review that participant and an unassigned staff member cannot access their workout/detail/readings/progress. Participants cannot read another participant's records. UI hiding alone is not the authorization test.
- Verify keyboard navigation, labels, focus, readable mobile layout, empty states, and revoked-device behavior. Report real ESP32 and sensor testing separately; a successful manual upload does not verify the hardware.

# MotionTrack — rep-based sessions with before/after BPM check-ins

Status: draft for approval · 2026-11-18

## 1. Intent

MotionTrack turns the existing ECE 198 exercise tracker into a rep-based system for a course demo:
a patient runs a workout session made of several exercises; for each exercise the ESP32 takes a
fresh heart rate (BPM) before the set, counts reps up to a target, freezes, then takes a fresh BPM after.
A doctor reviews their assigned patients' sessions live and afterwards.

The demo that defines success: one patient session containing an Arm Curl and a Back Row, each with its
own fresh before-BPM, counting that stops at its own target, and its own after-BPM; the assigned doctor
sees both exercise records; an unassigned doctor cannot; a missing BPM leaves an exercise Incomplete;
a retried Wi-Fi upload does not duplicate anything.

## 2. Goals, non-goals, anti-goals

Goals
- Patient: register/sign in on the patient entry point, start a session, pick exercises one at a time
  inside it (exercise + rep target), watch live progress, skip a failed reading, stop an exercise, end the session.
- Doctor: separate sign-in entry point; assigned patients only; session history with per-exercise target reps,
  recorded reps, before/after BPM with capture times, timestamps, status; live view; missing readings and stale
  device data visible.
- Backend migration that preserves every existing workout and reading.
- Complete Arduino sketch folder: Wi-Fi link, website-driven exercise selection, BPM check-ins, Serial bench controls.
- Exact local setup and demo steps.

Non-goals
- Continuous heart rate during a set (decided: check-ins only). Live heart-rate charts are removed.
- Custom exercise names, Squats, Arm raises, Bicep curls: the device cannot count them.
- Doctor actions that change data (no notes, no assigning targets). Doctor creation and assignment stay on the CLI.
- Hosting/deployment, TLS, medical interpretation of BPM, sensor threshold calibration.
- Creating the `motiontrack-esp32` GitHub repo (the user renames the existing repo in GitHub settings).

Anti-goals (failure even if it "works")
- A Wi-Fi retry that double-counts reps or saves a second result.
- Network calls that stall motion sampling and miss reps.
- Showing a stale or missing BPM as if it were a real reading; showing null as 0.
- A doctor seeing an unassigned patient's data via any route (UI hiding is not the protection).
- Any mention of Claude/AI in code, docs, UI, or commits (user's standing preference). Commits authored as the user.

## 3. Constraints

- Existing stack stays: Node 24 + Express 5 + built-in `node:sqlite`; React + Vite frontend; ESP32 DOIT DevKit V1
  with MPU6050 (software I2C, SDA32/SCL33), MAX30102 (Wire1, SDA25/SCL26), SSD1306 (Wire, SDA21/SCL22).
- Reuse `TiltRepCounter` and the three counter classes unchanged (thresholds for press/row still provisional).
- Reuse `participant`/`staff` roles; the UI says "patient"/"doctor".
- Device token lives only in firmware config (`secrets.h`, gitignored); never in the browser bundle or Git.
- One active exercise per device at a time (existing partial unique index stays).
- Browser origin `http://localhost:5173`, API `http://127.0.0.1:3000` (CORS rule unchanged). For the real ESP32,
  backend `HOST=0.0.0.0` and the laptop's LAN IP in firmware config.

## 4. Approaches considered

1. **Extend existing tables and the existing device polling endpoints (chosen).** Add a session table and rep/BPM
   columns to `workouts`; the device keeps polling `GET /api/device/workout` about once a second and keeps the
   sequence-numbered `POST .../updates` with exact-retry dedupe. Server owns the state machine.
   Fits the handoff, keeps retry safety, keeps old history linked.
2. Live push (WebSockets/MQTT) to the device. Lower latency, but adds a broker/server piece and loses the existing
   sequence-based retry protection. Rejected.
3. New separate tables for rep exercises, leaving `workouts` untouched. Simpler migration, but orphans old
   history from the new views and duplicates authorization code. Rejected.

## 5. Patient flow (decided with the user)

1. Sign in → **Start workout session** (choose which of their devices to use if they have more than one;
   with none, they are sent to add one; the token is shown once as today).
2. Inside the session: pick Arm Curl (forearm), Shoulder Press (upper arm) or Back Row (upper arm) — each card
   shows the mounting hint — and a target of 1–50 reps → **Start exercise**.
3. Device shows **PLACE YOUR FINGER**, then **Hold still** while reading, **Try again** if weak/unstable; it submits
   the before-BPM automatically. Counting starts only after a before-BPM is accepted **or skipped**.
4. OLED shows only e.g. `Arm Curl` / `7 / 10`, plus the existing "Fix your form for better results" warning.
5. At the target the count freezes and the device asks for the after-BPM.
6. Website then offers **Choose next exercise** or **End session**. Nothing starts until the patient presses start.
7. During a reading the website offers **Skip reading** (device keeps retrying until then — decided). Skipping the
   before-reading lets counting start but the exercise ends Incomplete. Skipping the after-reading ends it Incomplete.
8. **Stop exercise** during any phase → Incomplete, recorded data kept, back to choose-next.
9. **End session** with an unfinished exercise → that exercise becomes Incomplete, session ends.
10. Complete ⇔ recorded reps = target AND before-BPM AND after-BPM present (any values; lower/same after is fine).

Live exercise panel (my design): three steps `Before BPM → Reps → After BPM` with the current one highlighted;
large `7 / 10`; device status line ("Waiting for finger", "Hold still — reading", "Signal weak — trying again",
"Counting"); "Device not responding (last update N s ago)" after 5 s with no device contact while an exercise is open.
The session table below lists exercises done so far (same columns as the doctor table).

## 6. Doctor flow (approved)

- Separate entry point `/doctor`; patients use `/`. Signing in with the wrong account type on either page is refused
  with "This is a patient account. Use the patient sign-in." (and the reverse). Enforced on the server: the login
  request carries the entry point (`portal: patient|doctor`) and a mismatch returns 403 without creating a session.
- Dashboard: assigned patients, **Live now** badge when a session is active. Patient page: sessions newest first,
  each expandable to the per-exercise table (exercise, target, reps, before BPM + time, after BPM + time,
  started/ended, status). Live session rows refresh every second with device status and the not-responding warning.
- "Earlier timed workouts" list shows pre-migration workouts read-only.
- Missing readings shown as "No reading" (or "Skipped" when the patient skipped), never 0.

## 7. Data model (migration)

Versioning: `PRAGMA user_version`. Version 1 = today's schema; version 2 = MotionTrack. `db.js` runs the base schema
for new databases, then applies pending migrations inside one transaction. Existing data is copied, never dropped. An existing database at `user_version` 0 with the version-1 tables is treated
as version 1. The `workouts` rebuild runs with `PRAGMA foreign_keys = OFF` (then `foreign_key_check`, then ON), so
`workout_readings` rows, which cascade on delete, are not wiped.

New table `exercise_sessions`
- `id` TEXT PK, `participant_id` FK users, `device_id` (the device chosen at session start; composite FK with
  participant like `workouts`), `status` `active|ended`, `created_at`, `ended_at` NULL, `updated_at`.
- Partial unique index: one `active` session per participant.

`workouts` (rebuilt: create new table, copy rows, swap, recreate indexes)
- New: `kind` `timed|reps` (existing rows → `timed`), `session_id` NULL FK exercise_sessions,
  `exercise_id` NULL (`arm_curl|shoulder_press|back_row`), `target_reps` NULL (1–50),
  `phase` NULL (`before_bpm|counting|after_bpm|done`), `before_bpm`/`after_bpm` NULL INTEGER (1–300),
  `before_bpm_at`/`after_bpm_at` NULL, `before_skipped`/`after_skipped` INTEGER 0/1 default 0,
  `device_status` NULL (`waiting_finger|reading|weak_signal|counting`), `device_seen_at` NULL (updated on every
  device poll and upload for this workout, so a patient resting mid-set does not trigger the not-responding warning).
- `target_duration_seconds` becomes NULL-able. CHECK: `timed` rows need a duration; `reps` rows need session,
  exercise_id, target_reps, phase.
- `status` gains `incomplete` (`pending|active|completed|cancelled|incomplete`); `cancelled` stays for legacy rows.
- `exercise_name` stays (display name, e.g. "Arm Curl").

New table `workout_events` (rep workouts' upload log; legacy `workout_readings` untouched)
- `workout_id`, `sequence`, `type` (`status|before_bpm|progress|after_bpm`), `repetitions` NULL, `bpm` NULL,
  `capture_status` NULL, `received_at`; PK (`workout_id`, `sequence`).

## 8. API

Website (Bearer user token)
- `POST /api/sessions` {device_id} → 201 session (409 + existing session if one is active).
- `GET /api/sessions?limit&offset` → patient's sessions with their workouts, newest first.
- `GET /api/sessions/:id` → session + workouts (owner or assigned doctor).
- `POST /api/sessions/:id/exercises` {exercise_id, target_reps} → 201 workout (`pending`, phase `before_bpm`);
  409 if the session has an unfinished exercise or the device has one.
- `POST /api/workouts/:id/skip-reading` (no body) → skips the current BPM phase as in §5; 409 outside a BPM phase.
- `POST /api/workouts/:id/cancel` → for rep workouts sets `incomplete`, phase `done` (legacy behaviour unchanged).
- `POST /api/sessions/:id/end` → ends session; unfinished exercise → `incomplete`. Idempotent.
- Doctor: `GET /api/participants` adds `active_session_id`; `GET /api/participants/:id/sessions`.
- `GET /api/exercises` → `[{id:'arm_curl',name:'Arm Curl',placement:'forearm'}, …]`.
- Legacy routes keep working for reading old data; `POST /api/workouts` (timed creation) is removed from the UI
  but kept in the API so existing tests/docs stay valid.

Device (Bearer device token)
- `GET /api/device/workout` → `{workout: {id, kind, exercise_id, exercise_name, target_reps, phase, repetitions,
  last_sequence, status}}` or `{workout:null}`. Device polls ~1 s (configurable).
- `POST /api/device/workouts/:id/updates` for rep workouts: `{sequence, event, repetitions?, bpm?, capture_status?}`
  - `status`: `capture_status` only; updates `device_status`/`device_seen_at`; no state change.
  - `before_bpm`: allowed in phase `before_bpm`; saves BPM + time; phase → `counting`, status → `active`.
  - `progress`: cumulative `repetitions`, non-decreasing, ≤ target, only in `counting`; reaching target → `after_bpm`.
  - `after_bpm`: allowed in `after_bpm`; saves BPM; status → `completed` if complete per §5 else `incomplete`; phase `done`.
  - Exact retry of a stored sequence → 200 `duplicate:true`, no change (even after the workout ended).
    Same sequence with different data → 409. Lower unseen sequence → 409. Any new event on an ended workout → 409.
    Event not allowed in the current phase (e.g. after a website skip) → 409 with the current phase; the device re-polls.
  - Timed workouts keep today's upload format.
- Leftover open timed workouts (pending/active after migration, or created via the legacy API): the firmware does not
  run them and shows "Old workout — cancel it on the website"; the website lists any open timed workout with a
  Cancel button, since it blocks new exercises on that device.

## 9. Firmware (`firmware/MotionTrack/`)

- Files: `MotionTrack.ino`, the four counter headers (unchanged), `config.h` (tunables), `secrets.example.h`
  (`WIFI_SSID`, `WIFI_PASSWORD`, `API_BASE_URL`, `DEVICE_TOKEN`; copied to gitignored `secrets.h`),
  `HeartCheckIn.h` (BPM capture state machine), `DeviceLink.h/.cpp` (network task).
- Libraries: SparkFun MAX3010x, Adafruit SSD1306 + GFX, SoftWire (Steve Marple) + AsyncDelay, ArduinoJson 7;
  ESP32 Arduino core (WiFi, HTTPClient, FreeRTOS).
- Networking runs in a FreeRTOS task pinned to core 0; motion sampling/OLED stay in `loop()` on core 1. They share a
  small mutex-protected state (current workout from the last poll; outbound event queue). HTTP timeouts ≤ 3 s.
- Outbound events get their sequence number when first sent and are retried byte-identical until 2xx or 409.
  Unsent `progress` events are coalesced (latest cumulative count wins). `status` events are sent only on change.
- On a new workout ID: reset the selected counter's motion (`resetMotion(true)`), record a count baseline
  (`repsThisWorkout = counter.count() - baseline`; counter classes stay unchanged), start the before-BPM check-in.
  After a reboot the device resumes from the server's phase/repetitions/last_sequence.
- If the server phase differs from the device's (skip/stop from the website), the device follows the server.
  Workout gone (null) → device stops, shows "Session ended" briefly, then idle.
- BPM check-in (`HeartCheckIn`): fresh state per prompt; requires IR ≥ finger threshold; collects beat intervals via
  SparkFun `checkForBeat`; accepts when the last N (default 6) intervals all lie within ±P% (default 15%) of their
  median and the BPM is within 30–220; reports the median BPM. Finger lost or inconsistent for longer than T
  (default 8 s) → "Try again" and restart. All values in `config.h`. No 60–90 cap.
- OLED screens: idle "MotionTrack · Waiting for website"; Wi-Fi status; PLACE YOUR FINGER (large); Hold still;
  Try again; `Arm Curl` + `7 / 10` (large); existing FIX YOUR FORM screen; "Done".
- Serial bench mode: `1`/`2`/`3` select an exercise locally only when no website workout is active; counts print as today.
- Retry demo control: Serial `r` resends the last acknowledged upload byte-identical; Serial prints the server's
  `duplicate:true` reply, and the website's count does not change. (Pending user confirmation.)

## 10. Website

- Branding "MotionTrack". Patient app: Session (start/choose exercise/live panel/session table), History (sessions +
  earlier timed workouts), Devices (unchanged), Progress (completed exercises and reps over a selectable range,
  per exercise; duration metric removed; completed exercises only). Doctor app as §6 (no Progress tab).
- Polling: one awaited loop per open view, ~1 s while an exercise is live, 5 s for lists; abort on navigation;
  back off on network errors (existing patterns). Accessibility rules from the current site stay (18 px base,
  48 px controls, visible focus, labels, AA contrast, no colour-only states).

## 11. Verification

- Backend `node:test`: migration of a version-1 database with workouts/readings (all preserved, counts equal),
  session/exercise lifecycle, phase rules, skip/stop/end, completion rule incl. lower after-BPM, exact-retry dedupe
  and 409s, doctor assignment checks on every new route, wrong-role refusal.
- Website: Playwright run of the demo script against the real backend with a synthetic device script speaking the
  new protocol (test only).
- Firmware: compile with `arduino-cli` for `esp32:esp32:esp32doit-devkit-v1` if the toolchain can be downloaded here;
  host-side g++ tests for `HeartCheckIn` with synthetic beat timings. Real-sensor behaviour is reported as unverified.

## 12. Toolchain note

The Arduino and PlatformIO download hosts are blocked by this cloud environment's network policy. Compiling the
sketch here requires the user to approve adding those hosts; otherwise the firmware is delivered uncompiled and
the user compiles it in the Arduino IDE.

## 13. Left to the builder

Component/file structure, exact copy text, CSS, test organisation, JSON field order, task stack sizes, poll timing
defaults within the stated ranges.

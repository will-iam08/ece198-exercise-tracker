# MotionTrack demo: setup and script

This is the exact local setup and the course demo, in two versions: **A** with the synthetic test device (no
hardware) and **B** with the real ESP32. Run all commands from the repository root unless a step says otherwise.
Each step lists what must be visible for it to pass.

The website says "patient" and "doctor"; the CLI and API call those roles `participant` and `staff`.

## What has and has not been tested

Tested with the **synthetic test device** (`frontend/scripts/fake-device.mjs`, made-up numbers), the backend tests,
the website tests and the host-side firmware tests:

- the whole flow below on the website, the backend and the doctor view;
- retry safety (a repeated upload returns `duplicate:true` and changes nothing), phases, skip and stop rules;
- the firmware's check-in, exercise-flow and upload-queue logic with synthetic data on a PC.

**Not tested on hardware** (do these in part B and expect to adjust):

- real Wi-Fi from the ESP32 to the laptop;
- the MPU6050 rep counting, especially the Shoulder Press and Back Row thresholds;
- the MAX30102 heart-rate check-in (finger threshold, interval agreement, time limits);
- the OLED screens and the sensor mounting.

Nothing here has been tried with real patients; use made-up accounts.

## 1) One-time setup

Needs Node.js 24+ and npm. (Part B also needs the Arduino IDE or `arduino-cli`.)

```bash
cd backend
npm ci
test -f .env || cp .env.example .env
cd ../frontend
npm ci
test -f .env.local || cp .env.example .env.local
cd ..
```

Pass: both `npm ci` commands finish without errors.

Start from a clean database for the demo (stop the backend first if it is running; this deletes only the local demo data):

```bash
rm -f backend/data/ece198.sqlite backend/data/ece198.sqlite-wal backend/data/ece198.sqlite-shm
```

## 2) Start the servers

Terminal 1, backend:

```bash
cd backend
npm start
```

Pass: it prints `ECE 198 backend listening on http://127.0.0.1:3000`.

Check it from another terminal:

```bash
curl http://127.0.0.1:3000/api/health
```

Pass: `{"status":"ok"}`.

Terminal 2, website:

```bash
cd frontend
npm run dev
```

Pass: it shows `http://localhost:5173/`. Open that address in a browser (use `localhost`, not `127.0.0.1`).

## 3) Demo script

The numbers (targets 5 and 4 reps) keep the demo short; any target from 1 to 50 works.

### Step 1: register a patient

Open `http://localhost:5173/`, choose **Create an account**, and register `patient@example.com` with a password of
12 or more characters.

Pass: you are signed in and see the tabs Session, History, Progress and My devices.

### Step 2: add a device

Open **My devices**, add a device named `Demo ESP32`.

Pass: a device token is shown once. Copy it (**Copy token**) and keep it for the next steps, then press **I have
saved it — hide token**. The token cannot be shown again; if you lose it, add the device again.

### Step 3: start a session

Open **Session** and press **Start workout session**.

Pass: the session opens and offers the three exercises, each with its mounting hint (Arm Curl: forearm; Shoulder
Press and Back Row: upper arm).

### Step 4: Arm Curl (forearm) with a target

Choose **Arm Curl**, target **5**, press **Start exercise**.

Pass: the exercise shows three steps (Heart rate before, Reps, Heart rate after) with Heart rate before highlighted
and the device status waiting for the device.

**Part A (fake device).** In a third terminal:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 1000 --retry-last
```

**Part B (real ESP32).** Set the device up first (section 4), then wait for it to pick up the exercise.

Pass, in both parts, in this order:

1. **Before-BPM prompt.** The OLED (part B) shows `PLACE YOUR FINGER`, then `Hold still`; the website shows "Place your
   finger on the sensor", then "Hold still — reading". Part A prints `Step 1: heart rate before exercise`. After the reading the
   website shows the before BPM (part A: 78) with a time, and the Reps step is highlighted.
2. **Counting to the target.** The OLED shows `Arm Curl` and `1 / 5` up to `5 / 5`; the website shows the same count
   once a second. At 5 / 5 the count **freezes**: more motion does not change it.
3. **After BPM.** The device asks for the finger again; the website's third step is highlighted. The reading is saved
   (part A: 104) and the exercise shows **Complete** with reps 5 / 5, before BPM and after BPM.
4. Part A only: the script printed `Server reply: duplicate` after the first rep, and the count on the website did not
   change (see step 11).

### Step 5: Back Row (upper arm) in the same session

Under **Choose next exercise**, choose **Back Row**, enter target **4** and press **Start exercise**.

Part A:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 1000 --bpm-before 82 --bpm-after 110
```

Part B: attach the sensor to the upper arm as shown on the website, then follow the device.

Pass: the same sequence happens with a **fresh** before-BPM (part A: 82), counting that stops at `4 / 4`, and its own
after-BPM (part A: 110). The session table now lists two exercises, Arm Curl and Back Row, both Complete.

### Step 6: end the session

Press **End session**.

Pass: the session shows as ended and the table keeps both exercises.

### Step 7: create a doctor and assign the patient (CLI)

```bash
cd backend
export STAFF_PASSWORD='demo-doctor-password-1'
npm run manage -- create-staff doctor@example.com "Dr Demo"
unset STAFF_PASSWORD
npm run manage -- assign doctor@example.com patient@example.com
```

Pass: each command prints JSON; the first shows the new user with `"role": "staff"`, the second shows
`"assigned": true`.

### Step 8: the assigned doctor sees both exercises

Open `http://localhost:5173/doctor` (sign out of the patient first, or use a private window) and sign in as
`doctor@example.com`.

Pass: the dashboard lists the patient. Press **View workouts** next to the patient, then **Show exercises** on the
session: a table shows **Arm Curl** and **Back Row**, each with target reps, reps done, heart rate before with its time,
heart rate after with its time, start and end times and status Complete.

Check the sign-in entry points as well. Signing in at `/doctor` with the **patient** account, or at `/` with the
**doctor** account, must be refused with "This is a patient account. Use the patient sign-in." (or the doctor
equivalent).

### Step 9: an unassigned doctor sees nothing

Create a second doctor who is not assigned:

```bash
cd backend
export STAFF_PASSWORD='demo-doctor-password-2'
npm run manage -- create-staff other@example.com "Dr Other"
unset STAFF_PASSWORD
```

Sign in at `/doctor` as `other@example.com`.

Pass: the page says "No patients are assigned to you yet." The API agrees. Get a token and ask for the patient's
sessions. First get the patient's id: sign in as the patient through the API and read `user.id` from the reply
(`"user":{"id":"..."}`):

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"patient@example.com","password":"<the patient password from step 1>","portal":"patient"}'
```

Then get the other doctor's token:

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"other@example.com","password":"demo-doctor-password-2","portal":"doctor"}'
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer <token from the previous command>' \
  http://127.0.0.1:3000/api/participants/<patient id>/sessions
```

Pass: `404`. The same request with the assigned doctor's token returns `200`.

Remove and restore the assignment to see access follow it (optional):

```bash
cd backend
npm run manage -- unassign doctor@example.com patient@example.com
```

Pass: the first doctor's patient list becomes empty after the page refreshes (the doctor's patient list refreshes every 5 seconds, so within about 5 seconds). Re-run `assign` from
step 7 to restore it.

### Step 10: a skipped or missing BPM leaves an exercise Incomplete

Sign in as the patient again, start a session if none is active, and start **Arm Curl** with target **3**.

Part A, device that never completes the after reading:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 800 --no-after-bpm
```

Wait until the reps reach `3 / 3` and the device keeps reporting "waiting for finger" or "weak signal" for the after
reading, then press **Skip reading** on the website.

Part B: take the first reading, count to the target, then do not put a finger on the sensor and press **Skip
reading** on the website.

Pass: the exercise shows status **Incomplete**; the after BPM shows "Skipped" (not 0); reps 3 / 3 and the before BPM are
kept. Skipping the **before** reading also works: counting then starts, but the exercise can only end Incomplete.
Ending the session while an exercise is still unfinished does the same. A stopped exercise (**Stop exercise**) is
Incomplete and keeps what was recorded.

### Step 11: a retried upload is not counted twice (`duplicate:true`)

This is the demo of retry safety: the same upload sent twice is stored once.

**Part A.** Start a new exercise (under **Choose next exercise**, pick any exercise, enter target **5** and press
**Start exercise**) and run the fake device with `--retry-last`:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 1000 --retry-last
```

Pass: after the first counted rep the script prints `Retry test: sending upload #N again, byte for byte...` and then
`Server reply: duplicate (#N was already saved; nothing changed, still 1 / 5 reps)`. The website's count does not jump.

**Part B.** With the ESP32 connected to the laptop's Serial Monitor (115200 baud), after the first rep type `r` and
press Enter.

Pass: Serial prints a line like `Retry seq 7 -> HTTP 200 duplicate:true`, and the website's count does not change.

## 4) Demo with the real ESP32 (part B): setup

1. Make the backend reachable from the Wi-Fi: in `backend/.env` set `HOST=0.0.0.0`, then restart `npm start`.
   Find the laptop's LAN IP address with one of these:

   ```bash
   hostname -I
   ```

   ```bash
   ipconfig getifaddr en0
   ```

   (the first on Linux, the second on macOS; on Windows use `ipconfig`.) Check from another device on the same
   network that `http://<laptop IP>:3000/api/health` returns `{"status":"ok"}`. If not, allow port 3000 in the laptop
   firewall. The website still runs at `http://localhost:5173` on the laptop.
2. Add the device on the website (step 2) and copy the token: it is shown once.
3. Configure and flash the firmware by following [../firmware/README.md](../firmware/README.md): copy
   `secrets.example.h` to `secrets.h`, set `WIFI_SSID`, `WIFI_PASSWORD`, `DEVICE_TOKEN` and
   `API_BASE_URL=http://<laptop IP>:3000`, then compile and upload for **DOIT ESP32 DEVKIT V1**. Open the Serial
   Monitor at 115200 baud.
4. Keep the sensor still for the start-up calibration.

Pass: the OLED shows `MotionTrack` / `Waiting for website` and the bottom line shows Wi-Fi and server status
connected. `Device not registered` means the token is wrong or the device was removed; add the device again and
update `secrets.h`. Then run the demo script from step 3 and ignore the "Part A" commands.

## 5) Automated checks (no demo needed)

```bash
cd backend && npm test
```

```bash
cd frontend && npm test && npm run build
```

```bash
bash firmware/tests/run.sh
```

Pass: each command finishes with all tests passing (the build prints a completed bundle).

## 6) Troubleshooting

- **Browser shows a network or origin error.** Open the site at `http://localhost:5173`, not `127.0.0.1`.
- **Port already in use.** Stop the earlier backend or `npm run dev`; the dev server refuses to change ports.
- **`409 A session is already active`.** End the active session on the website first.
- **The fake device says `The server refused the device token (401)`.** Add the device again and use the new token.
- **Nothing happens on the device.** Start an exercise on the website first. The device only runs the exercise
  the website has started for it.
- **Start over.** Stop the backend first, then run the `rm -f` command from section 1 and start it again.

More detail: [backend README](../backend/README.md) (API and protocol), [frontend README](../frontend/README.md),
[firmware README](../firmware/README.md) and the [design record](design/2026-11-18-motiontrack-design.md).

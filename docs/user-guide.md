# Using the MotionTrack website

This guide walks through the website screen by screen: first for patients, then for doctors, then for the person
who runs the server and sets up doctor accounts. For installing and starting the servers, see the
[README](../README.md); for the full course demo with pass conditions, see [demo.md](demo.md).

With the servers running locally, the website has two entry points:

| Who | Address |
| --- | --- |
| Patients | `http://localhost:5173/` |
| Doctors | `http://localhost:5173/doctor` |

Use `localhost`, not `127.0.0.1`: the backend only accepts requests from that exact address.

For privacy you are signed out whenever the page is reloaded or closed. Signing in again brings you back to a
workout session that is still running.

## Patients

### 1. Create an account

1. Open `http://localhost:5173/` and press **Create an account**.
2. Enter your name, email address and a password of 12 to 128 characters.
3. Press **Create account**. You are signed in and see four tabs: **Session**, **History**, **Progress** and
   **My devices**.

Next time, sign in with the same email and password on the **Sign in** form.

### 2. Add your exercise device

The ESP32 needs its own token before it can send anything to your account. You do this once per device.

1. Open **My devices**.
2. Under **Add a device**, type a name (for example "Wrist ESP32") and press **Add device**.
3. A device token appears. **It is shown only once.** Press **Copy token** and put it in the device's
   `secrets.h` file (see [firmware/README.md](../firmware/README.md)).
4. Press **I have saved it — hide token**. The token cannot be shown again; if it is lost, remove the device
   and add it again.

Your devices are listed under **Choose the device to use**, with the time each one last contacted the server.
**Remove device** stops its token from working; your past workouts are kept.

### 3. Start a workout session

A session holds the exercises you do today.

1. Open **Session**. If you have more than one device, choose the one you are wearing.
2. Press **Start workout session**.

### 4. Choose an exercise

1. Under **1. Choose an exercise**, pick a card: **Arm Curl** (device on the forearm), **Shoulder Press** or
   **Back Row** (device on the upper arm). Each card shows where to wear the device.
2. Under **2. How many reps?**, enter a whole number from 1 to 50.
3. Press **Start exercise**, then follow the screen on the device.

### 5. Follow the exercise

The live screen updates about once a second and shows:

- **The steps**, in order, each marked Done, Now or Next:
  1. **Before BPM**: put your finger on the heart-rate sensor and keep still.
  2. **Counting**: do your reps. The device stops counting at your target.
  3. **After BPM**: put your finger on the sensor again.
  4. **Done**: the exercise is saved.
- **The rep counter**, for example `7 / 10`, with a progress bar.
- **The device line**, saying what the device is doing: "Place your finger on the sensor", "Hold still —
  reading", "Signal weak — trying again", "Counting", or "Waiting for the device".

If the device has not been heard from for more than 5 seconds, the screen turns amber and shows
**Device not responding (last update N s ago)**. Check that the device is switched on and connected to Wi-Fi;
the screen goes back to normal as soon as it reports again. If the website itself loses the server, it says
**Lost connection to the server** and keeps trying.

Two buttons let you change course:

- **Skip reading** (during a heart-rate step) moves on without that reading. The exercise is then saved as
  Incomplete.
- **Stop exercise**, then **Yes, stop exercise**, ends it now. It is saved as Incomplete with the reps counted
  so far.

When the exercise ends, a summary appears at the top and you can pick the next one under
**Choose next exercise**.

### 6. End the session

Press **End session**, then **Yes, end session**. If an exercise is still running, it is saved as Incomplete.
The session moves to your history, and **Start a new session** begins another.

### 7. History

**History** lists your workout sessions, newest first, with the date, whether it is in progress or ended, and how
many exercises were complete. Press **Show exercises** to see each exercise's target, reps done, heart rate
before and after, start and end times, and status. Use **Newer** and **Older** to page through long lists.

Workouts recorded before sessions existed are listed under **Earlier timed workouts** and are read-only.

### 8. Progress

**Progress** counts **complete** exercises only. Choose a **Time range** (last 7, 30 or 90 days, or all time),
an **Exercise** (or all exercises), and what to **Show on chart** (completed exercises or repetitions). The
tiles show the totals and the bar chart shows them per day (per month for long ranges). **Show these numbers as
a table** gives the same numbers as a table. Days are counted in UTC.

## What the statuses mean

| Status | Meaning |
| --- | --- |
| **Not started yet** | The exercise is set up and waiting for the device. |
| **In progress** | The device is working through the steps. |
| **Complete** | Every target rep was counted and both heart-rate readings were taken. |
| **Incomplete** | Something is missing: a reading was skipped or failed, the exercise was stopped early, or the session ended while it was running. |
| **Cancelled** | An older timed workout that was cancelled. |

A heart rate is shown as a number in bpm, **Skipped**, **No reading**, or **Waiting**. A missing reading is never
shown as 0.

## Doctors

Doctor accounts are created by the person running the server (see below); there is no sign-up for doctors on
the website.

1. Open `http://localhost:5173/doctor` and sign in. Patient accounts cannot sign in here, and doctor accounts
   cannot sign in on the patient page.
2. **Your patients** lists only the patients assigned to you, with the number assigned and how many are
   exercising now. A **Live now** badge marks a patient whose session is running. The list refreshes every 5
   seconds.
3. Press **View workouts** to open a patient. If they are exercising, the **Live session** panel follows the
   current exercise, including the "Device not responding" warning. Below it is the patient's full session
   history, the same as their own **History** tab.
4. Press **← All patients** to go back.

Everything a doctor sees is read-only: there are no buttons that change a patient's records. If a doctor has no
patients yet, the list says "No patients are assigned to you yet."

## Setting up doctors and assignments

Whoever runs the backend manages doctors from a terminal in the `backend` folder. The patient must have created
an account on the website first.

Create a doctor. The password is read from `STAFF_PASSWORD` and is never written to `.env`:

```bash
read -rs 'STAFF_PASSWORD?Doctor password (12-128 characters): '; echo; export STAFF_PASSWORD
```

```bash
npm run manage -- create-staff doctor@example.com "Dr Name"
```

```bash
unset STAFF_PASSWORD
```

Assign a patient to a doctor, or remove the assignment:

```bash
npm run manage -- assign doctor@example.com patient@example.com
```

```bash
npm run manage -- unassign doctor@example.com patient@example.com
```

A doctor can have many patients and a patient can have more than one doctor. A doctor who asks for a patient
not assigned to them gets "not found".

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "That email or password is not correct." | Check both and try again. Passwords are case-sensitive. |
| "This is a patient account. Use the patient sign-in." (or the doctor version) | Use the other sign-in page. |
| "An account with this email already exists." | Sign in instead of creating an account. |
| A network or origin error when signing in | Make sure the backend is running and that you opened `localhost`, not `127.0.0.1`. |
| "Device not responding" | Check the device's power and Wi-Fi, and that its `API_BASE_URL` uses the computer's network address. |
| "An old workout is still open" | Press **Cancel old workout**; it stays in your history. |
| You were signed out | Reloading or closing the page signs you out. Sign in again; a running session is still there. |

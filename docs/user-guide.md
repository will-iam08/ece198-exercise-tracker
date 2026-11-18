# Using the MotionTrack website

This guide walks through the website screen by screen: first for patients, then for doctors, then for admins and
the person who runs the server and sets up doctor accounts. For installing and starting the servers, see the
[README](../README.md); for the full course demo with pass conditions, see [demo.md](demo.md).

With the servers running locally, the website has three entry points:

| Who | Address |
| --- | --- |
| Patients | `http://localhost:5173/` |
| Doctors | `http://localhost:5173/doctor` |
| Admins | `http://localhost:5173/admin` |

Each sign-in page accepts only its own kind of account. To open the site from a phone on the same Wi-Fi, or
through a live domain, see [demo.md section 6](demo.md#6-other-devices-the-lan-and-a-live-domain).

For privacy you are signed out whenever the page is reloaded or closed. Signing in again brings you back to a
workout session that is still running.

## Patients

### 1. Create an account

1. Open `http://localhost:5173/` and press **Create an account**.
2. Enter your name, email address and a password of 12 to 128 characters.
3. Press **Create account**. You are signed in and see five tabs: **Session**, **History**, **Progress**,
   **Messages** and **My devices**.

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

If your doctor has set a care plan, a **From Your Doctor** card at the top of the Session tab shows their notes,
how many reps to do for each exercise, and the heart-rate range to be in after exercising.

### 4. Choose an exercise

1. Under **1. Choose an exercise**, pick a card: **Arm Curl** (device on the forearm), **Shoulder Press** or
   **Back Row** (device on the upper arm). Each card shows where to wear the device.
2. Under **2. How many reps?**, enter a whole number from 1 to 50. If your doctor prescribed a number for that
   exercise, it is filled in for you (each card shows "Doctor's target"); you can still change it.
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

With a care plan, the table also has a **Care plan** column. For each exercise it says, with a badge and in words,
whether you **Met** the prescribed reps or were **Below** them, and whether your heart rate after was **In range**,
**Above** or **Below** the target (or **No reading**). It compares with your current plan.

Workouts recorded before sessions existed are listed under **Earlier timed workouts** and are read-only.

### 8. Progress

**Progress** counts **complete** exercises only. Choose a **Time range** (last 7, 30 or 90 days, or all time),
an **Exercise** (or all exercises), and what to **Show on chart** (completed exercises or repetitions). The
tiles show the totals and the bar chart shows them per day (per month for long ranges). **Show these numbers as
a table** gives the same numbers as a table. Days are counted in UTC.

### 9. Messages

Open **Messages** to ask your doctor a question: add a subject if you like, type the question and press **Send
question**. Your questions are listed below the form with the date, and a doctor's reply appears under each one
(the page checks for replies every 15 seconds). If the server has an email bot, the tab also shows its address:
you can email your question there instead, **from the email address you signed up with**; emails from other
addresses are not delivered.

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

1. Open `http://localhost:5173/doctor` and sign in. Patient and admin accounts cannot sign in here, and doctor
   accounts cannot sign in on the patient or admin page.
2. **Patient Message Inbox**, at the top, holds questions from your assigned patients, sent from the website or by
   email. The badge says how many are unread; each message shows the patient's name and email, the subject, the
   question, when it arrived and **New** or **Read**. Use **Mark as read** (or **Mark as unread**), type in the reply
   box and press **Send reply** (this also marks it read), or press **Open patient record**. Tick **Show unread
   messages only** to hide the rest. The inbox refreshes every 10 seconds.
3. **Your patients** lists only the patients assigned to you, with the number assigned and how many are
   exercising now. A **Live now** badge marks a patient whose session is running. The list refreshes every 5
   seconds.
4. Press **View workouts** to open a patient. If they are exercising, the **Live session** panel follows the
   current exercise, including the "Device not responding" warning. Below it is the patient's full session
   history, the same as their own **History** tab.
5. **Care Plan: Notes, Target Reps & Heart Rate** on the same page sets what the patient sees under **From Your
   Doctor**: notes (up to 1000 characters), target reps for each exercise (1 to 50, or empty for none) and the
   lowest and highest heart rate after exercise (30 to 220 bpm, or empty). Press **Save care plan**. The session
   tables then show whether each exercise met those targets.
6. Press **← All patients** to go back.

Exercise records are read-only for doctors: there are no buttons that change a patient's workouts. Doctors can
only write care plans and replies. If a doctor has no patients yet, the list says "No patients are assigned to you
yet."

## Admins

Admins sign in at `http://localhost:5173/admin`. The portal has four tabs:

- **Overview**: totals for patients, doctors, workout sessions, exercises recorded, devices and unread messages,
  the patients exercising now and any patient without a doctor.
- **All patients**: every patient with their doctors, number of sessions and last session. **View sessions** opens
  the same patient page a doctor sees (live session, care plan and history) for any patient.
- **Assignments**: choose a **Doctor** and a **Patient** and press **Assign patient**. Below, each doctor is listed
  with their patients; **Unassign** removes one. A patient can have more than one doctor.
- **Doctor accounts**: **Create doctor account** with a name, email and temporary password (12 to 128
  characters). Give the password to the doctor in person.

The overview refreshes every 10 seconds.

## Setting up admins, doctors and assignments

Whoever runs the backend creates the first admin from a terminal in the `backend` folder. Doctors and assignments
can then be managed on the admin portal, or with the commands below. A patient must have created an account on the
website before they can be assigned.

Create an admin. The password is read from `ADMIN_PASSWORD` (or `STAFF_PASSWORD` if that is not set):

```bash
read -rs 'ADMIN_PASSWORD?Admin password (12-128 characters): '; echo; export ADMIN_PASSWORD
```

```bash
npm run manage -- create-admin admin@example.com "Admin Name"
```

```bash
unset ADMIN_PASSWORD
```

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
| "This is a patient account. Use the patient sign-in." (or the doctor or admin version) | Use the sign-in page it names. |
| "An account with this email already exists." | Sign in instead of creating an account. |
| A network or origin error when signing in | Make sure the backend and the website server (`npm run dev`) are both running, and open the site through the website server. |
| "Device not responding" | Check the device's power and Wi-Fi, and that its `API_BASE_URL` uses the computer's network address. |
| "An old workout is still open" | Press **Cancel old workout**; it stays in your history. |
| You were signed out | Reloading or closing the page signs you out. Sign in again; a running session is still there. |

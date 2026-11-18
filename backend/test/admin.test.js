import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, password } from './fixture.js';

const sessionRows = f => f.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n;

test('each sign-in page accepts only its own account type and creates no session otherwise', async t => {
  const f = await fixture(t);
  await f.register('pat@example.com');
  await f.staff('doc@example.com');
  await f.admin('boss@example.com');
  const login = (email, portal, status = 200) => f.request('/api/auth/login', { method: 'POST', body: { email, password, portal }, status });

  const cases = [
    ['pat@example.com', 'doctor', 'This is a patient account. Use the patient sign-in.'],
    ['pat@example.com', 'admin', 'This is a patient account. Use the patient sign-in.'],
    ['doc@example.com', 'patient', 'This is a doctor account. Use the doctor sign-in.'],
    ['doc@example.com', 'admin', 'This is a doctor account. Use the doctor sign-in.'],
    ['boss@example.com', 'patient', 'This is an admin account. Use the admin sign-in.'],
    ['boss@example.com', 'doctor', 'This is an admin account. Use the admin sign-in.'],
  ];
  for (const [email, portal, message] of cases) {
    const before = sessionRows(f);
    const { data } = await login(email, portal, 403);
    assert.equal(data.error.message, message, `${email} on ${portal}`);
    assert.equal(sessionRows(f), before, 'no session row is created');
  }
  assert.equal((await login('pat@example.com', 'patient')).data.user.role, 'participant');
  assert.equal((await login('doc@example.com', 'doctor')).data.user.role, 'staff');
  assert.equal((await login('boss@example.com', 'admin')).data.user.role, 'admin');
  await login('boss@example.com', 'owner', 400);
  // A wrong password is still 401 on every page, so the 403 never reveals an account to a guesser.
  await f.request('/api/auth/login', { method: 'POST', body: { email: 'boss@example.com', password: 'wrong-password!', portal: 'doctor' }, status: 401 });
});

test('admin routes: overview, doctor accounts and assignments are admin-only', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice@example.com');
  const bob = await f.register('bob@example.com');
  const doctor = await f.staff('doc@example.com', [alice.user.id]);
  const admin = await f.admin();
  const tracker = await f.device(alice.token);
  const session = (await f.request('/api/sessions', { method: 'POST', token: alice.token, body: { device_id: tracker.device.id }, status: 201 })).data.session;

  for (const token of [alice.token, doctor.token]) {
    await f.request('/api/admin/overview', { token, status: 403 });
    await f.request('/api/admin/doctors', { method: 'POST', token, body: { name: 'X', email: 'x@example.com', password }, status: 403 });
    await f.request('/api/admin/assignments', { method: 'POST', token, body: { staff_id: doctor.id, participant_id: bob.user.id }, status: 403 });
    await f.request('/api/admin/assignments', { method: 'DELETE', token, body: { staff_id: doctor.id, participant_id: alice.user.id }, status: 403 });
  }
  await f.request('/api/admin/overview', { status: 401 });

  const overview = (await f.request('/api/admin/overview', { token: admin.token })).data;
  assert.deepEqual(overview.patients.map(p => p.email), ['alice@example.com', 'bob@example.com']);
  assert.equal(overview.patients[0].active_session_id, session.id);
  assert.equal(overview.patients[0].session_count, 1);
  assert.equal('password_hash' in overview.patients[0], false);
  assert.deepEqual(overview.doctors.map(d => [d.email, d.patient_count]), [['doc@example.com', 1]]);
  assert.deepEqual(overview.assignments, [{ staff_id: doctor.id, participant_id: alice.user.id }]);
  assert.deepEqual(overview.stats, {
    patients: 2, doctors: 1, assignments: 1, sessions: 1, active_sessions: 1, workouts: 0, completed_workouts: 0,
    devices: 1, messages: 0, unread_messages: 0,
  });

  // Create a doctor: validation, duplicates, and the new account can sign in to the doctor portal.
  await f.request('/api/admin/doctors', { method: 'POST', token: admin.token, body: { name: 'Weak', email: 'weak@example.com', password: 'short' }, status: 400 });
  await f.request('/api/admin/doctors', { method: 'POST', token: admin.token, body: { name: 'Bad', email: 'not-an-email', password }, status: 400 });
  await f.request('/api/admin/doctors', { method: 'POST', token: admin.token, body: { name: 'Role', email: 'r@example.com', password, role: 'admin' }, status: 400 });
  await f.request('/api/admin/doctors', { method: 'POST', token: admin.token, body: { name: 'Dup', email: 'ALICE@example.com', password }, status: 409 });
  const created = (await f.request('/api/admin/doctors', {
    method: 'POST', token: admin.token, body: { name: 'Dr New', email: 'New@Example.com', password }, status: 201,
  })).data.user;
  assert.equal(created.role, 'staff');
  assert.equal(created.email, 'new@example.com');
  assert.equal('password_hash' in created, false);
  const newDoctor = (await f.request('/api/auth/login', { method: 'POST', body: { email: 'new@example.com', password, portal: 'doctor' } })).data;
  assert.deepEqual((await f.request('/api/participants', { token: newDoctor.token })).data.participants, []);

  // Assign and unassign.
  const assign = (body, status) => f.request('/api/admin/assignments', { method: 'POST', token: admin.token, body, status });
  await assign({ staff_id: created.id, participant_id: bob.user.id }, 201);
  await assign({ staff_id: created.id, participant_id: bob.user.id }, 200);
  await assign({ staff_id: bob.user.id, participant_id: alice.user.id }, 404);
  await assign({ staff_id: created.id, participant_id: created.id }, 404);
  await assign({ staff_id: created.id, participant_id: admin.id }, 404);
  await assign({ staff_id: created.id }, 400);
  assert.deepEqual((await f.request('/api/participants', { token: newDoctor.token })).data.participants.map(p => p.id), [bob.user.id]);
  await f.request(`/api/participants/${bob.user.id}/sessions`, { token: newDoctor.token });
  await f.request('/api/admin/assignments', { method: 'DELETE', token: admin.token, body: { staff_id: created.id, participant_id: bob.user.id }, status: 204 });
  await f.request('/api/admin/assignments', { method: 'DELETE', token: admin.token, body: { staff_id: created.id, participant_id: bob.user.id }, status: 404 });
  await f.request(`/api/participants/${bob.user.id}/sessions`, { token: newDoctor.token, status: 404 });
  assert.equal((await f.request('/api/admin/overview', { token: admin.token })).data.stats.assignments, 1);
});

test('admins can read every patient; doctors stay limited to their assigned patients', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice@example.com');
  const bob = await f.register('bob@example.com');
  const doctor = await f.staff('doc@example.com', [alice.user.id]);
  const admin = await f.admin();
  const bDevice = await f.device(bob.token);
  const bSession = (await f.request('/api/sessions', { method: 'POST', token: bob.token, body: { device_id: bDevice.device.id }, status: 201 })).data.session;
  const bWorkout = await f.workout(bob.token, bDevice.device.id);

  for (const path of [`/api/participants/${bob.user.id}/sessions`, `/api/participants/${bob.user.id}/workouts`,
    `/api/participants/${bob.user.id}/progress`, `/api/sessions/${bSession.id}`, `/api/workouts/${bWorkout.id}`]) {
    await f.request(path, { token: admin.token });
    await f.request(path, { token: doctor.token, status: 404 });
  }
  // Doctors and admins cannot be looked up as patients.
  await f.request(`/api/participants/${doctor.id}/sessions`, { token: admin.token, status: 404 });
  await f.request('/api/participants/no-such-id/sessions', { token: admin.token, status: 404 });
  // Admins read; they do not act as a patient or as a doctor.
  await f.request('/api/participants', { token: admin.token, status: 403 });
  await f.request('/api/sessions', { method: 'POST', token: admin.token, body: { device_id: bDevice.device.id }, status: 403 });
  await f.request(`/api/workouts/${bWorkout.id}/cancel`, { method: 'POST', token: admin.token, status: 403 });
});

test('care plans: assigned doctor and admin only, validated, and shown to the patient', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice@example.com');
  const bob = await f.register('bob@example.com');
  const doctor = await f.staff('doc@example.com', [alice.user.id]);
  const other = await f.staff('other@example.com', [bob.user.id]);
  const admin = await f.admin();
  const path = `/api/participants/${alice.user.id}/plan`;
  const body = { notes: '  Go slowly on the first set.  ', arm_curl_reps: 12, shoulder_press_reps: 8, target_bpm_min: 60, target_bpm_max: 120 };

  assert.equal((await f.request(path, { token: doctor.token })).data.plan, null);
  assert.equal((await f.request('/api/plan', { token: alice.token })).data.plan, null);
  await f.request(path, { token: other.token, status: 404 });
  await f.request(path, { method: 'PUT', token: other.token, body, status: 404 });
  await f.request(path, { token: alice.token, status: 403 });
  await f.request(path, { method: 'PUT', token: alice.token, body, status: 403 });
  await f.request('/api/participants/no-such-id/plan', { token: admin.token, status: 404 });
  await f.request('/api/plan', { token: doctor.token, status: 403 });

  const saved = (await f.request(path, { method: 'PUT', token: doctor.token, body })).data.plan;
  assert.equal(saved.notes, 'Go slowly on the first set.');
  assert.equal(saved.arm_curl_reps, 12);
  assert.equal(saved.back_row_reps, null);
  assert.equal(saved.staff_id, doctor.id);
  assert.equal(saved.doctor_name, 'Exercise staff');
  const mine = (await f.request('/api/plan', { token: alice.token })).data.plan;
  assert.deepEqual(mine, saved);
  assert.equal((await f.request('/api/plan', { token: bob.token })).data.plan, null);

  for (const bad of [
    { arm_curl_reps: 0 }, { arm_curl_reps: 51 }, { back_row_reps: 2.5 }, { shoulder_press_reps: '10' },
    { target_bpm_min: 29 }, { target_bpm_max: 221 }, { target_bpm_min: 130, target_bpm_max: 120 },
    { notes: 'x'.repeat(1001) }, { notes: 5 }, { unknown: 1 },
  ]) {
    await f.request(path, { method: 'PUT', token: doctor.token, body: { ...body, ...bad }, status: 400 });
  }
  assert.equal((await f.request(path, { token: doctor.token })).data.plan.arm_curl_reps, 12);

  // An admin can edit too; fields left out are cleared.
  const byAdmin = (await f.request(path, { method: 'PUT', token: admin.token, body: { back_row_reps: 50, target_bpm_min: 30, target_bpm_max: 220 } })).data.plan;
  assert.equal(byAdmin.notes, '');
  assert.equal(byAdmin.arm_curl_reps, null);
  assert.equal(byAdmin.back_row_reps, 50);
  assert.equal(byAdmin.doctor_name, 'Site admin');
  // Unassigning removes the doctor's access to the plan.
  f.db.prepare('DELETE FROM staff_participants WHERE staff_id = ?').run(doctor.id);
  await f.request(path, { token: doctor.token, status: 404 });
});

test('CORS accepts each configured origin and the methods the site uses', async t => {
  const f = await fixture(t, ':memory:', { corsOrigin: 'http://localhost:5173, https://motiontrack.example.org' });
  for (const origin of ['http://localhost:5173', 'https://motiontrack.example.org']) {
    const { headers } = await f.request('/api/health', { headers: { Origin: origin } });
    assert.equal(headers.get('access-control-allow-origin'), origin);
  }
  const preflight = await f.request('/api/participants/x/plan', {
    method: 'OPTIONS', status: 204, headers: { Origin: 'https://motiontrack.example.org', 'Access-Control-Request-Method': 'PUT' },
  });
  assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
  await f.request('/api/health', { headers: { Origin: 'http://127.0.0.1:5173' }, status: 403 });
});

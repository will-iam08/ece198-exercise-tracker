import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../security.js';
import { fixture, password } from './fixture.js';

test('public routes, participant registration, login, expiry, and logout', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/health')).data, { status: 'ok' });
  assert.deepEqual((await f.request('/api/exercises')).data.exercises, [
    { id: 'arm_curl', name: 'Arm Curl', placement: 'forearm' },
    { id: 'shoulder_press', name: 'Shoulder Press', placement: 'upper arm' },
    { id: 'back_row', name: 'Back Row', placement: 'upper arm' },
  ]);
  await f.request('/api/unknown', { status: 404 });
  await f.request('/api/me', { status: 401 });
  await f.request('/api/auth/register', {
    method: 'POST', body: { name: 'Intruder', email: 'intruder@example.com', password, role: 'staff' }, status: 400,
  });
  await f.request('/api/auth/register', {
    method: 'POST', body: { name: 'Weak', email: 'weak@example.com', password: 'short' }, status: 400,
  });
  const session = await f.register('Participant@Example.com');
  assert.equal(session.user.role, 'participant');
  assert.equal(session.user.email, 'participant@example.com');
  assert.ok(Date.parse(session.expires_at) > Date.now());
  assert.ok(session.token);
  assert.equal('password_hash' in session.user, false);
  await f.register('other@example.com');
  await f.request('/api/auth/register', {
    method: 'POST', body: { name: 'Duplicate', email: 'PARTICIPANT@example.com', password }, status: 409,
  });
  assert.equal((await f.request('/api/me', { token: session.token })).data.user.id, session.user.id);
  await f.request('/api/auth/login', {
    method: 'POST', body: { email: session.user.email, password: 'wrong-password' }, status: 401,
  });
  const login = (await f.request('/api/auth/login', {
    method: 'POST', body: { email: 'PARTICIPANT@example.com', password },
  })).data;
  assert.equal(login.user.id, session.user.id);
  assert.notEqual(login.token, session.token);
  await f.request('/api/auth/logout', { method: 'POST', token: login.token, status: 204 });
  await f.request('/api/me', { token: login.token, status: 401 });
  await f.db.run('UPDATE auth_sessions SET expires_at = ? WHERE user_id = ?',
    '2000-01-01T00:00:00.000Z', session.user.id);
  await f.request('/api/me', { token: session.token, status: 401 });
});

test('live workouts persist heart rate, handle retries, and summarize completed exercise', async t => {
  const f = await fixture(t);
  const user = await f.register();
  const tracker = await f.device(user.token);
  assert.ok(tracker.device_token);
  assert.equal('token_hash' in tracker.device, false);
  const listed = (await f.request('/api/devices', { token: user.token })).data.devices;
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes(tracker.device_token), false);
  assert.equal('token_hash' in listed[0], false);
  assert.equal((await f.request('/api/device/workout', { token: tracker.device_token })).data.workout, null);

  const workout = await f.workout(user.token, tracker.device.id);
  assert.equal(workout.status, 'pending');
  assert.equal(workout.target_duration_seconds, 120);
  assert.equal((await f.request('/api/device/workout', { token: tracker.device_token })).data.workout.id, workout.id);
  await f.request('/api/workouts', {
    method: 'POST', token: user.token,
    body: { device_id: tracker.device.id, exercise_name: 'Bicep curls', target_duration_seconds: 120 }, status: 409,
  });
  const path = `/api/device/workouts/${workout.id}/updates`;
  const update = async (body, status = 200) => (await f.request(path, {
    method: 'POST', token: tracker.device_token, body, status,
  })).data;
  const first = { sequence: 1, repetitions: 5, elapsed_seconds: 30, heart_rate_bpm: 100, completed: false };
  const live = await update(first);
  assert.equal(live.workout.status, 'active');
  assert.equal(live.workout.repetitions, 5);
  assert.equal(live.workout.heart_rate_bpm, 100);
  assert.ok(live.workout.started_at);
  assert.equal(live.duplicate, false);
  assert.equal((await update(first)).duplicate, true);
  await update({ ...first, repetitions: 6 }, 409);

  await update({ sequence: 3, repetitions: 12, elapsed_seconds: 60, heart_rate_bpm: null });
  await update({ sequence: 2, repetitions: 8, elapsed_seconds: 40 }, 409);
  await update({ sequence: 4, repetitions: 11, elapsed_seconds: 65 }, 409);
  await update({ sequence: 4, repetitions: 13, elapsed_seconds: 59 }, 409);
  const final = { sequence: 4, repetitions: 18, elapsed_seconds: 90, heart_rate_bpm: 120, completed: true };
  const completed = await update(final);
  assert.equal(completed.workout.status, 'completed');
  assert.ok(completed.workout.ended_at);
  assert.equal((await update(final)).duplicate, true);
  await update({ ...final, sequence: 5, repetitions: 19 }, 409);
  assert.equal((await f.request('/api/device/workout', { token: tracker.device_token })).data.workout, null);

  const detail = (await f.request(`/api/workouts/${workout.id}`, { token: user.token })).data.workout;
  assert.equal(detail.repetitions, 18);
  assert.equal(detail.elapsed_seconds, 90);
  assert.equal(detail.heart_rate_bpm, 120);
  const readings = (await f.request(`/api/workouts/${workout.id}/readings?limit=2&offset=1`, { token: user.token })).data;
  assert.equal(readings.total, 3);
  assert.deepEqual(readings.readings.map(reading => reading.sequence), [3, 4]);
  assert.deepEqual(readings.readings.map(reading => reading.heart_rate_bpm), [null, 120]);
  const history = (await f.request('/api/workouts?status=completed&limit=1&offset=0', { token: user.token })).data;
  assert.equal(history.total, 1);
  assert.equal(history.workouts[0].id, workout.id);
  await f.request(`/api/workouts/${workout.id}/cancel`, { method: 'POST', token: user.token, status: 409 });

  const custom = await f.workout(user.token, tracker.device.id, 'Wall push-ups');
  assert.equal(custom.exercise_name, 'Wall push-ups');
  assert.equal((await f.request(`/api/workouts/${custom.id}/cancel`, { method: 'POST', token: user.token })).data.workout.status, 'cancelled');
  await f.request(`/api/workouts/${custom.id}/cancel`, { method: 'POST', token: user.token });
  const progress = (await f.request('/api/progress', { token: user.token })).data;
  assert.equal(progress.completed_workouts, 1);
  assert.equal(progress.total_repetitions, 18);
  assert.equal(progress.total_duration_seconds, 90);
  assert.equal(progress.daily.length, 1);
  assert.equal(progress.daily[0].exercise_name, 'Bicep curls');
  assert.equal(progress.daily[0].repetitions, 18);
  assert.equal((await f.request('/api/progress?exercise_name=Squats', { token: user.token })).data.completed_workouts, 0);
  assert.equal((await f.request('/api/workouts?exercise_name=Wall%20push-ups', { token: user.token })).data.total, 1);
});

test('staff assignments, participant ownership, and device credentials enforce separate access', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice@example.com');
  const bob = await f.register('bob@example.com');
  const aDevice = await f.device(alice.token, 'Alice tracker');
  const bDevice = await f.device(bob.token, 'Bob tracker');
  const aWorkout = await f.workout(alice.token, aDevice.device.id);
  const bWorkout = await f.workout(bob.token, bDevice.device.id, 'Squats');
  const staffId = randomUUID();
  await f.db.run('INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)',
    staffId, 'Exercise staff', 'staff@example.com', await hashPassword(password), 'staff', new Date().toISOString());
  const staff = (await f.request('/api/auth/login', { method: 'POST', body: { email: 'staff@example.com', password } })).data;
  assert.deepEqual((await f.request('/api/participants', { token: staff.token })).data.participants, []);
  await f.request(`/api/workouts/${aWorkout.id}`, { token: staff.token, status: 404 });
  await f.db.run('INSERT INTO staff_participants (staff_id,participant_id) VALUES (?,?)', staffId, alice.user.id);
  const participants = (await f.request('/api/participants', { token: staff.token })).data.participants;
  assert.deepEqual(participants.map(person => person.id), [alice.user.id]);
  assert.equal('password_hash' in participants[0], false);
  assert.equal((await f.request(`/api/participants/${alice.user.id}/workouts`, { token: staff.token })).data.total, 1);
  assert.equal((await f.request(`/api/participants/${alice.user.id}/progress`, { token: staff.token })).data.completed_workouts, 0);
  await f.request(`/api/workouts/${aWorkout.id}`, { token: staff.token });
  await f.request(`/api/workouts/${aWorkout.id}/readings`, { token: staff.token });
  await f.request(`/api/participants/${bob.user.id}/workouts`, { token: staff.token, status: 404 });
  await f.request(`/api/participants/${bob.user.id}/progress`, { token: staff.token, status: 404 });
  await f.request('/api/participants', { token: alice.token, status: 403 });
  await f.request('/api/devices', { method: 'POST', token: staff.token, body: { name: 'Staff device' }, status: 403 });
  await f.request('/api/workouts', {
    method: 'POST', token: staff.token,
    body: { device_id: aDevice.device.id, exercise_name: 'Bicep curls', target_duration_seconds: 120 }, status: 403,
  });
  await f.request(`/api/workouts/${aWorkout.id}`, { token: bob.token, status: 404 });
  await f.request(`/api/workouts/${aWorkout.id}/readings`, { token: bob.token, status: 404 });
  await f.request(`/api/workouts/${aWorkout.id}/cancel`, { method: 'POST', token: bob.token, status: 404 });
  await f.request(`/api/workouts/${bWorkout.id}`, { token: alice.token, status: 404 });
  await f.request('/api/workouts', {
    method: 'POST', token: bob.token,
    body: { device_id: aDevice.device.id, exercise_name: 'Bicep curls', target_duration_seconds: 120 }, status: 404,
  });
  await f.request(`/api/device/workouts/${aWorkout.id}/updates`, {
    method: 'POST', token: bDevice.device_token, body: { sequence: 1, repetitions: 1, elapsed_seconds: 2 }, status: 404,
  });
  await f.request('/api/device/workout', { token: alice.token, status: 401 });
  await f.request('/api/me', { token: aDevice.device_token, status: 401 });
  await f.request(`/api/devices/${aDevice.device.id}`, { method: 'DELETE', token: bob.token, status: 404 });
  await f.request(`/api/devices/${aDevice.device.id}`, { method: 'DELETE', token: alice.token, status: 204 });
  await f.request('/api/device/workout', { token: aDevice.device_token, status: 401 });
  assert.equal((await f.request(`/api/workouts/${aWorkout.id}`, { token: alice.token })).data.workout.status, 'cancelled');
  assert.deepEqual((await f.request('/api/devices', { token: alice.token })).data.devices, []);
  await f.db.run('DELETE FROM staff_participants WHERE staff_id = ? AND participant_id = ?', staffId, alice.user.id);
  await f.request(`/api/workouts/${aWorkout.id}`, { token: staff.token, status: 404 });
});

test('input validation, parameterized filters, and browser CORS', async t => {
  const f = await fixture(t);
  await f.request('/api/auth/register', { method: 'POST', raw: '{oops', status: 400 });
  await f.request('/api/auth/register', { method: 'POST', body: [], status: 400 });
  await f.request('/api/auth/register', { method: 'POST', body: null, status: 400 });
  await f.request('/api/auth/register', { method: 'POST', body: { name: 'x', email: 'invalid', password }, status: 400 });
  const user = await f.register();
  const tracker = await f.device(user.token);
  for (const target_duration_seconds of [0, -1, 1.5, '120', 86401]) {
    await f.request('/api/workouts', {
      method: 'POST', token: user.token,
      body: { device_id: tracker.device.id, exercise_name: 'Bicep curls', target_duration_seconds }, status: 400,
    });
  }
  await f.request('/api/workouts', {
    method: 'POST', token: user.token,
    body: { device_id: tracker.device.id, exercise_name: ' ', target_duration_seconds: 120 }, status: 400,
  });
  const workout = await f.workout(user.token, tracker.device.id);
  const update = `/api/device/workouts/${workout.id}/updates`;
  const valid = { sequence: 1, repetitions: 1, elapsed_seconds: 2 };
  for (const bad of [
    { sequence: 0 }, { sequence: 1.5 }, { repetitions: -1 }, { elapsed_seconds: '2' },
    { heart_rate_bpm: 0 }, { heart_rate_bpm: 301 }, { heart_rate_bpm: '100' }, { completed: 'true' },
  ]) {
    await f.request(update, { method: 'POST', token: tracker.device_token, body: { ...valid, ...bad }, status: 400 });
  }
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=nope', 'status=unknown']) {
    await f.request('/api/workouts?' + query, { token: user.token, status: 400 });
  }
  const injection = encodeURIComponent("' OR 1=1 --");
  assert.equal((await f.request(`/api/workouts?exercise_name=${injection}`, { token: user.token })).data.total, 0);
  assert.equal((await f.request(`/api/progress?exercise_name=${injection}`, { token: user.token })).data.completed_workouts, 0);
  await f.request('/api/devices', { method: 'POST', token: user.token, body: { name: 'x'.repeat(20000) }, status: 413 });
  const permitted = await f.request('/api/health', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(permitted.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  await f.request('/api/workouts', {
    method: 'OPTIONS', status: 204,
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  const disallowed = await fetch(f.base + '/api/health', { headers: { Origin: 'https://other.example' } });
  assert.equal(disallowed.headers.get('access-control-allow-origin'), null);
  await disallowed.text();
});

test('workout and heart-rate history survive a database reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ece198-backend-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'history.sqlite');
  const first = await fixture(t, path);
  const user = await first.register();
  const tracker = await first.device(user.token);
  const workout = await first.workout(user.token, tracker.device.id);
  await first.request(`/api/device/workouts/${workout.id}/updates`, {
    method: 'POST', token: tracker.device_token,
    body: { sequence: 1, repetitions: 15, elapsed_seconds: 120, heart_rate_bpm: 105, completed: true },
  });
  await first.close();
  const reopened = await fixture(t, path);
  const saved = (await reopened.request(`/api/workouts/${workout.id}`, { token: user.token })).data.workout;
  assert.equal(saved.status, 'completed');
  assert.equal(saved.repetitions, 15);
  assert.equal(saved.heart_rate_bpm, 105);
  const history = (await reopened.request(`/api/workouts/${workout.id}/readings`, { token: user.token })).data;
  assert.equal(history.total, 1);
  assert.equal(history.readings[0].heart_rate_bpm, 105);
  assert.deepEqual(await reopened.db.all('PRAGMA foreign_key_check'), []);
  await reopened.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, password } from './fixture.js';

async function setup(t) {
  const f = await fixture(t);
  const user = await f.register();
  const tracker = await f.device(user.token);
  const post = (path, token, body, status = 200) => f.request(path, { method: 'POST', token, body, status });
  const start = async () => (await post('/api/sessions', user.token, { device_id: tracker.device.id }, 201)).data.session;
  const exercise = (session, body, status = 201, token = user.token) =>
    post(`/api/sessions/${session.id}/exercises`, token, body, status);
  return { f, user, tracker, post, start, exercise };
}

test('session lifecycle', async t => {
  const { f, user, tracker, post, start, exercise } = await setup(t);
  const session = await start();
  assert.equal(session.status, 'active');
  assert.equal(session.device_id, tracker.device.id);
  assert.equal(session.ended_at, null);
  assert.deepEqual(session.workouts, []);
  const conflict = (await post('/api/sessions', user.token, { device_id: tracker.device.id }, 409)).data;
  assert.equal(conflict.error.session_id, session.id);
  await post('/api/sessions', user.token, { device_id: 'missing' }, 404);

  const w = (await exercise(session, { exercise_id: 'arm_curl', target_reps: 10 })).data.workout;
  assert.equal(w.kind, 'reps');
  assert.equal(w.status, 'pending');
  assert.equal(w.phase, 'before_bpm');
  assert.equal(w.exercise_name, 'Arm Curl');
  assert.equal(w.session_id, session.id);
  await exercise(session, { exercise_id: 'back_row', target_reps: 5 }, 409);
  const detail = (await f.request(`/api/sessions/${session.id}`, { token: user.token })).data;
  assert.ok(Date.parse(detail.server_time));
  assert.deepEqual(detail.session.workouts.map(x => x.id), [w.id]);

  const ended = (await post(`/api/sessions/${session.id}/end`, user.token)).data.session;
  assert.equal(ended.status, 'ended');
  assert.ok(ended.ended_at);
  assert.equal(ended.workouts[0].status, 'incomplete');
  assert.equal(ended.workouts[0].phase, 'done');
  assert.ok(ended.workouts[0].ended_at);
  const again = (await post(`/api/sessions/${session.id}/end`, user.token)).data.session;
  assert.equal(again.ended_at, ended.ended_at);
  await exercise(session, { exercise_id: 'arm_curl', target_reps: 3 }, 409);

  const list = (await f.request('/api/sessions', { token: user.token })).data;
  assert.equal(list.total, 1);
  assert.equal(list.limit, 10);
  assert.equal(list.sessions[0].workouts.length, 1);
  assert.ok(list.server_time);
  assert.equal((await f.request('/api/sessions?status=active', { token: user.token })).data.total, 0);
  await f.request('/api/sessions?limit=51', { token: user.token, status: 400 });
  await f.request('/api/sessions?status=bogus', { token: user.token, status: 400 });
  await f.request('/api/sessions?x=1', { token: user.token, status: 400 });
  await start();
});

test('device with an open timed workout blocks new exercises; revoking ends everything', async t => {
  const { f, user, tracker, post, start, exercise } = await setup(t);
  const legacy = await f.workout(user.token, tracker.device.id);
  const session = await start();
  await exercise(session, { exercise_id: 'arm_curl', target_reps: 4 }, 409);
  await post(`/api/workouts/${legacy.id}/cancel`, user.token);
  const w = (await exercise(session, { exercise_id: 'arm_curl', target_reps: 4 })).data.workout;
  await f.request(`/api/devices/${tracker.device.id}`, { method: 'DELETE', token: user.token, status: 204 });
  const after = (await f.request(`/api/sessions/${session.id}`, { token: user.token })).data.session;
  assert.equal(after.status, 'ended');
  assert.equal(after.workouts[0].id, w.id);
  assert.equal(after.workouts[0].status, 'incomplete');
  assert.equal(after.workouts[0].phase, 'done');
  await exercise(session, { exercise_id: 'arm_curl', target_reps: 4 }, 409);

  const other = await f.device(user.token, 'Second');
  const timed = await f.workout(user.token, other.device.id);
  const s2 = (await post('/api/sessions', user.token, { device_id: other.device.id }, 201)).data.session;
  await f.request(`/api/devices/${other.device.id}`, { method: 'DELETE', token: user.token, status: 204 });
  assert.equal((await f.request(`/api/workouts/${timed.id}`, { token: user.token })).data.workout.status, 'cancelled');
  assert.equal((await f.request(`/api/sessions/${s2.id}`, { token: user.token })).data.session.status, 'ended');
});

test('validation', async t => {
  const { user, tracker, post, start, exercise } = await setup(t);
  const session = await start();
  await exercise(session, { exercise_id: 'squats', target_reps: 5 }, 400);
  for (const target_reps of [0, 51, '5', 1.5]) {
    await exercise(session, { exercise_id: 'arm_curl', target_reps }, 400);
  }
  await exercise(session, { exercise_id: 'arm_curl' }, 400);
  await exercise(session, { exercise_id: 'arm_curl', target_reps: 5, extra: 1 }, 400);
  await post('/api/sessions', user.token, { device_id: tracker.device.id, extra: 1 }, 400);
  await post('/api/sessions', user.token, {}, 400);
  await exercise(session, { exercise_id: 'arm_curl', target_reps: 50 });
});

test('skip-reading', async t => {
  const { f, user, post, start, exercise } = await setup(t);
  const session = await start();
  const w = (await exercise(session, { exercise_id: 'shoulder_press', target_reps: 5 })).data.workout;
  const skipped = (await post(`/api/workouts/${w.id}/skip-reading`, user.token)).data.workout;
  assert.equal(skipped.before_skipped, 1);
  assert.equal(skipped.phase, 'counting');
  assert.equal(skipped.status, 'active');
  const wrong = (await post(`/api/workouts/${w.id}/skip-reading`, user.token, undefined, 409)).data;
  assert.equal(wrong.error.phase, 'counting');
  f.db && await f.db.run("UPDATE workouts SET phase = 'after_bpm' WHERE id = ?", w.id);
  const done = (await post(`/api/workouts/${w.id}/skip-reading`, user.token)).data.workout;
  assert.equal(done.after_skipped, 1);
  assert.equal(done.phase, 'done');
  assert.equal(done.status, 'incomplete');
  assert.ok(done.ended_at);
  await post(`/api/workouts/${w.id}/skip-reading`, user.token, undefined, 409);

  const w2 = (await exercise(session, { exercise_id: 'back_row', target_reps: 5 })).data.workout;
  const cancelled = (await post(`/api/workouts/${w2.id}/cancel`, user.token)).data.workout;
  assert.equal(cancelled.status, 'incomplete');
  assert.equal(cancelled.phase, 'done');
  assert.equal((await post(`/api/workouts/${w2.id}/cancel`, user.token)).data.workout.status, 'incomplete');
  await f.db.run("UPDATE workouts SET status = 'completed' WHERE id = ?", w2.id);
  await post(`/api/workouts/${w2.id}/cancel`, user.token, undefined, 409);
});

test('portal', async t => {
  const { f, user } = await setup(t);
  const staff = await f.staff();
  const count = async () => (await f.db.get('SELECT COUNT(*) AS n FROM auth_sessions')).n;
  const before = await count();
  const login = async (email, portal, status) => (await f.request('/api/auth/login', {
    method: 'POST', body: { email, password, portal }, status,
  })).data;
  assert.equal((await login('participant@example.com', 'doctor', 403)).error.message,
    'This is a patient account. Use the patient sign-in.');
  assert.equal((await login('staff@example.com', 'patient', 403)).error.message,
    'This is a doctor account. Use the doctor sign-in.');
  assert.equal(await count(), before);
  await login('participant@example.com', 'bogus', 400);
  assert.ok((await login('participant@example.com', 'patient', 200)).token);
  assert.ok((await login('staff@example.com', 'doctor', 200)).token);
  assert.ok(staff.token && user.token);
});

test('doctor access', async t => {
  const { f, user, post, start, exercise } = await setup(t);
  const other = await f.register('other@example.com');
  const otherDevice = await f.device(other.token);
  const doctor = await f.staff('doc@example.com', [user.user.id]);
  const stranger = await f.staff('stranger@example.com');
  const session = await start();
  const w = (await exercise(session, { exercise_id: 'arm_curl', target_reps: 5 })).data.workout;

  assert.equal((await f.request(`/api/sessions/${session.id}`, { token: doctor.token })).data.session.id, session.id);
  const theirs = (await f.request(`/api/participants/${user.user.id}/sessions`, { token: doctor.token })).data;
  assert.equal(theirs.total, 1);
  assert.equal(theirs.sessions[0].workouts[0].id, w.id);
  assert.ok(theirs.server_time);
  const people = (await f.request('/api/participants', { token: doctor.token })).data.participants;
  assert.equal(people[0].active_session_id, session.id);
  await f.request(`/api/sessions/${session.id}`, { token: stranger.token, status: 404 });
  await f.request(`/api/participants/${user.user.id}/sessions`, { token: stranger.token, status: 404 });

  await f.request(`/api/sessions/${session.id}`, { token: other.token, status: 404 });
  await exercise(session, { exercise_id: 'arm_curl', target_reps: 5 }, 404, other.token);
  await post(`/api/sessions/${session.id}/end`, other.token, undefined, 404);
  await post(`/api/workouts/${w.id}/skip-reading`, other.token, undefined, 404);
  await post('/api/sessions', other.token, { device_id: (await f.device(user.token, 'x')).device.id }, 404);
  assert.ok(otherDevice);

  await post('/api/sessions', doctor.token, { device_id: 'x' }, 403);
  await exercise(session, { exercise_id: 'arm_curl', target_reps: 5 }, 403, doctor.token);
  await post(`/api/sessions/${session.id}/end`, doctor.token, undefined, 403);
  await post(`/api/workouts/${w.id}/skip-reading`, doctor.token, undefined, 403);
  await f.request('/api/sessions', { token: doctor.token, status: 403 });

  await post(`/api/sessions/${session.id}/end`, user.token);
  assert.equal((await f.request('/api/participants', { token: doctor.token })).data.participants[0].active_session_id, null);
});

test('double start races', async t => {
  const { f, user, start } = await setup(t);
  const session = await start();
  const results = await Promise.all([1, 2].map(async () => (await fetch(`${f.base}/api/sessions/${session.id}/exercises`, {
    method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise_id: 'arm_curl', target_reps: 5 }),
  })).status));
  assert.deepEqual(results.sort(), [201, 409]);
});

test('kind filter', async t => {
  const { f, user, start, exercise, tracker } = await setup(t);
  const legacy = await f.workout(user.token, tracker.device.id);
  await f.request(`/api/workouts/${legacy.id}/cancel`, { method: 'POST', token: user.token });
  const session = await start();
  const w = (await exercise(session, { exercise_id: 'arm_curl', target_reps: 5 })).data.workout;
  const ids = async q => (await f.request('/api/workouts' + q, { token: user.token })).data.workouts.map(x => x.id);
  assert.deepEqual(await ids('?kind=timed'), [legacy.id]);
  assert.deepEqual(await ids('?kind=reps'), [w.id]);
  assert.equal((await ids('')).length, 2);
  await f.request('/api/workouts?kind=other', { token: user.token, status: 400 });
  await f.db.run("UPDATE workouts SET status = 'completed', repetitions = 5, elapsed_seconds = 9 WHERE id = ?", w.id);
  const reps = (await f.request('/api/progress?kind=reps', { token: user.token })).data;
  assert.equal(reps.completed_workouts, 1);
  assert.equal(reps.daily[0].date, new Date().toISOString().slice(0, 10));
  assert.equal((await f.request('/api/progress?kind=timed', { token: user.token })).data.completed_workouts, 0);
  const doctor = await f.staff('doc2@example.com', [user.user.id]);
  assert.equal((await f.request(`/api/participants/${user.user.id}/workouts?kind=reps`, { token: doctor.token })).data.total, 1);
  assert.equal((await f.request(`/api/participants/${user.user.id}/progress?kind=reps`, { token: doctor.token })).data.completed_workouts, 1);
});

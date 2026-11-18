import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';

async function setup(t) {
  const f = await fixture(t);
  const user = await f.register();
  const tracker = await f.device(user.token);
  const dev = tracker.device_token;
  const post = (path, token, body, status = 200) => f.request(path, { method: 'POST', token, body, status });
  const session = (await post('/api/sessions', user.token, { device_id: tracker.device.id }, 201)).data.session;
  const exercise = async (exercise_id = 'arm_curl', target_reps = 3) =>
    (await post(`/api/sessions/${session.id}/exercises`, user.token, { exercise_id, target_reps }, 201)).data.workout;
  const send = (w, body, status = 200) => post(`/api/device/workouts/${w.id}/updates`, dev, body, status);
  const current = async () => (await f.request('/api/device/workout', { token: dev })).data.workout;
  const events = w => f.db.prepare('SELECT COUNT(*) AS n FROM workout_events WHERE workout_id = ?').get(w.id).n;
  return { f, user, tracker, dev, post, session, exercise, send, current, events };
}

test('full demo flow', async t => {
  const { f, user, session, exercise, send, current } = await setup(t);
  const w = await exercise('arm_curl', 3);
  assert.equal((await current()).id, w.id);
  let r = (await send(w, { sequence: 1, event: 'status', capture_status: 'waiting_finger' })).data;
  assert.equal(r.duplicate, false);
  assert.equal(r.workout.device_status, 'waiting_finger');
  assert.equal(r.workout.status, 'active');
  assert.equal(r.workout.phase, 'before_bpm');
  r = (await send(w, { sequence: 2, event: 'before_bpm', bpm: 78 })).data;
  assert.equal(r.workout.before_bpm, 78);
  assert.ok(r.workout.before_bpm_at && r.workout.started_at);
  assert.equal(r.workout.phase, 'counting');
  for (const n of [1, 2, 3]) {
    r = (await send(w, { sequence: 2 + n, event: 'progress', repetitions: n })).data;
    assert.equal(r.workout.repetitions, n);
    assert.equal(r.workout.device_status, 'counting');
  }
  assert.equal(r.workout.phase, 'after_bpm');
  assert.equal(r.workout.status, 'active');
  r = (await send(w, { sequence: 6, event: 'after_bpm', bpm: 70 })).data;
  assert.equal(r.workout.status, 'completed');
  assert.equal(r.workout.phase, 'done');
  assert.equal(r.workout.after_bpm, 70);
  assert.ok(r.workout.ended_at);
  assert.equal(await current(), null);

  const w2 = await exercise('back_row', 2);
  await send(w2, { sequence: 1, event: 'before_bpm', bpm: 80 });
  await send(w2, { sequence: 2, event: 'progress', repetitions: 2 });
  r = (await send(w2, { sequence: 3, event: 'after_bpm', bpm: 90 })).data;
  assert.equal(r.workout.status, 'completed');
  const detail = (await f.request(`/api/sessions/${session.id}`, { token: user.token })).data.session;
  assert.deepEqual(detail.workouts.map(x => x.id), [w.id, w2.id]);
});

test('exact retry is a duplicate', async t => {
  const { exercise, send, events } = await setup(t);
  const w = await exercise('arm_curl', 2);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 70 });
  await send(w, { sequence: 2, event: 'progress', repetitions: 1 });
  const before = events(w);
  const r = (await send(w, { sequence: 2, event: 'progress', repetitions: 1 })).data;
  assert.equal(r.duplicate, true);
  assert.equal(r.workout.repetitions, 1);
  assert.equal(events(w), before);
  await send(w, { sequence: 2, event: 'progress', repetitions: 2 }, 409);
  await send(w, { sequence: 3, event: 'progress', repetitions: 2 });
  await send(w, { sequence: 4, event: 'after_bpm', bpm: 65 });
  const again = (await send(w, { sequence: 4, event: 'after_bpm', bpm: 65 })).data;
  assert.equal(again.duplicate, true);
  assert.equal(again.workout.status, 'completed');
  await send(w, { sequence: 4, event: 'after_bpm', bpm: 66 }, 409);
});

test('phase rules', async t => {
  const { exercise, send } = await setup(t);
  const w = await exercise('shoulder_press', 3);
  const e = (await send(w, { sequence: 1, event: 'progress', repetitions: 1 }, 409)).data;
  assert.equal(e.error.phase, 'before_bpm');
  await send(w, { sequence: 1, event: 'after_bpm', bpm: 70 }, 409);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 70 });
  await send(w, { sequence: 2, event: 'before_bpm', bpm: 71 }, 409);
  await send(w, { sequence: 3, event: 'progress', repetitions: 4 }, 400);
  await send(w, { sequence: 3, event: 'progress', repetitions: 2 });
  await send(w, { sequence: 4, event: 'progress', repetitions: 1 }, 409);
  await send(w, { sequence: 3, event: 'status', capture_status: 'counting' }, 409);
  await send(w, { sequence: 2, event: 'progress', repetitions: 3 }, 409);
  const ended = (await send(w, { sequence: 4, event: 'after_bpm', bpm: 70 }, 409)).data;
  assert.equal(ended.error.phase, 'counting');
  await send(w, { sequence: 4, event: 'progress', repetitions: 3 });
  await send(w, { sequence: 5, event: 'after_bpm', bpm: 70 });
  await send(w, { sequence: 6, event: 'status', capture_status: 'reading' }, 409);
  await send(w, { sequence: 6, event: 'progress', repetitions: 3 }, 409);
});

test('field rules', async t => {
  const { exercise, send } = await setup(t);
  const w = await exercise('arm_curl', 3);
  await send(w, { sequence: 1, event: 'bogus' }, 400);
  await send(w, { sequence: 0, event: 'status', capture_status: 'reading' }, 400);
  await send(w, { sequence: 1, event: 'status' }, 400);
  await send(w, { sequence: 1, event: 'status', capture_status: 'nope' }, 400);
  await send(w, { sequence: 1, event: 'status', capture_status: 'reading', bpm: 70 }, 400);
  await send(w, { sequence: 1, event: 'before_bpm' }, 400);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 0 }, 400);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 301 }, 400);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 70, repetitions: 0 }, 400);
  await send(w, { sequence: 1, event: 'progress', repetitions: -1 }, 400);
  await send(w, { sequence: 1, event: 'progress' }, 400);
  await send(w, { sequence: 1, event: 'progress', repetitions: 1, bpm: 70 }, 400);
  await send(w, { sequence: 1, event: 'status', capture_status: 'reading', extra: 1 }, 400);
});

test('missing bpm leaves incomplete', async t => {
  const { user, post, exercise, send } = await setup(t);
  let w = await exercise('arm_curl', 2);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 70 });
  await send(w, { sequence: 2, event: 'progress', repetitions: 2 });
  let skipped = (await post(`/api/workouts/${w.id}/skip-reading`, user.token)).data.workout;
  assert.equal(skipped.status, 'incomplete');
  assert.equal(skipped.after_bpm, null);
  assert.equal(skipped.phase, 'done');

  w = await exercise('back_row', 2);
  await post(`/api/workouts/${w.id}/skip-reading`, user.token);
  await send(w, { sequence: 1, event: 'progress', repetitions: 2 });
  const r = (await send(w, { sequence: 2, event: 'after_bpm', bpm: 80 })).data;
  assert.equal(r.workout.status, 'incomplete');
  assert.equal(r.workout.before_bpm, null);
  assert.equal(r.workout.after_bpm, 80);
  assert.equal(r.workout.phase, 'done');
});

test('skip races device bpm', async t => {
  const { user, post, exercise, send } = await setup(t);
  let w = await exercise('arm_curl', 2);
  await post(`/api/workouts/${w.id}/skip-reading`, user.token);
  const e = (await send(w, { sequence: 1, event: 'before_bpm', bpm: 70 }, 409)).data;
  assert.equal(e.error.phase, 'counting');

  await send(w, { sequence: 1, event: 'progress', repetitions: 2 });
  await post(`/api/workouts/${w.id}/skip-reading`, user.token);
  w = await exercise('back_row', 2);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 70 });
  const s = (await post(`/api/workouts/${w.id}/skip-reading`, user.token, undefined, 409)).data;
  assert.equal(s.error.phase, 'counting');
});

test('revoke mid exercise', async t => {
  const { f, user, tracker, dev, session, exercise, send } = await setup(t);
  const w = await exercise('arm_curl', 3);
  await send(w, { sequence: 1, event: 'before_bpm', bpm: 70 });
  await f.request(`/api/devices/${tracker.device.id}`, { method: 'DELETE', token: user.token, status: 204 });
  const got = (await f.request(`/api/workouts/${w.id}`, { token: user.token })).data.workout;
  assert.equal(got.status, 'incomplete');
  const s = (await f.request(`/api/sessions/${session.id}`, { token: user.token })).data.session;
  assert.equal(s.status, 'ended');
  await f.request('/api/device/workout', { token: dev, status: 401 });
});

test('device_seen_at updates on poll and upload', async t => {
  const { f, exercise, send, dev, current } = await setup(t);
  assert.equal(await current(), null);
  const w = await exercise('arm_curl', 3);
  assert.equal(w.device_seen_at, null);
  const polled = await current();
  assert.ok(polled.device_seen_at);
  await new Promise(r => setTimeout(r, 5));
  const first = polled.device_seen_at;
  const up = (await send(w, { sequence: 1, event: 'status', capture_status: 'reading' })).data.workout;
  assert.ok(up.device_seen_at > first);
  await new Promise(r => setTimeout(r, 5));
  const dup = (await send(w, { sequence: 1, event: 'status', capture_status: 'reading' })).data;
  assert.equal(dup.duplicate, true);
  assert.ok(dup.workout.device_seen_at > up.device_seen_at);
  assert.ok(f.db.prepare('SELECT device_seen_at FROM workouts WHERE id = ?').get(w.id).device_seen_at);
  assert.ok(dev);
});

test('rep upload to an unknown or other device workout is 404', async t => {
  const { f, user, post, exercise } = await setup(t);
  const w = await exercise('arm_curl', 3);
  const other = (await f.device(user.token, 'Second tracker')).device_token;
  const body = { sequence: 1, event: 'progress', repetitions: 1 };
  const missing = (await post('/api/device/workouts/999999/updates', other, body, 404)).data;
  assert.equal(missing.error.message, 'Workout not found');
  const foreign = (await post(`/api/device/workouts/${w.id}/updates`, other, body, 404)).data;
  assert.equal(foreign.error.message, 'Workout not found');
  await post(`/api/device/workouts/${w.id}/updates`, other, { sequence: 1, event: 'status', capture_status: 'reading' }, 404);
});

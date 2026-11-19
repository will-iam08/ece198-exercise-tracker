import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { createDatabase } from '../db.js';
import { hashPassword } from '../security.js';

export const password = 'exercise-test-password';

export async function fixture(t, path = ':memory:', options = {}) {
  const db = await createDatabase(path);
  const app = createApp({ db, corsOrigin: 'http://localhost:5173', ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  }
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', token, body, raw, headers = {}, status = 200 } = {}) {
    if (token) headers = { ...headers, Authorization: `Bearer ${token}` };
    if (body !== undefined || raw !== undefined) headers = { 'Content-Type': 'application/json', ...headers };
    const response = await fetch(base + path, {
      method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return { data: text ? JSON.parse(text) : null, headers: response.headers };
  }
  async function register(email = 'participant@example.com') {
    return (await request('/api/auth/register', {
      method: 'POST', body: { name: 'Test participant', email, password }, status: 201,
    })).data;
  }
  async function device(token, name = 'Wrist tracker') {
    return (await request('/api/devices', { method: 'POST', token, body: { name }, status: 201 })).data;
  }
  async function workout(token, device_id, exercise_name = 'Bicep curls') {
    return (await request('/api/workouts', {
      method: 'POST', token, body: { device_id, exercise_name, target_duration_seconds: 120 }, status: 201,
    })).data.workout;
  }
  async function account(role, email, name) {
    const id = randomUUID();
    await db.run('INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)',
      id, name, email, await hashPassword(password), role, new Date().toISOString());
    const login = (await request('/api/auth/login', { method: 'POST', body: { email, password } })).data;
    return { id, ...login };
  }
  async function staff(email = 'staff@example.com', assignTo = []) {
    const login = await account('staff', email, 'Exercise staff');
    for (const participantId of assignTo) {
      await db.run('INSERT INTO staff_participants (staff_id,participant_id) VALUES (?,?)', login.id, participantId);
    }
    return login;
  }
  const admin = (email = 'admin@example.com') => account('admin', email, 'Site admin');
  return { db, base, request, register, device, workout, staff, admin, close };
}

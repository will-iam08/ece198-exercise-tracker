import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app.js';
import { createDatabase } from '../db.js';
import { LATEST_VERSION } from '../migrations.js';
import { password } from './fixture.js';

function fakeLibsqlClient(raw = new DatabaseSync(':memory:')) {
  raw.exec('PRAGMA foreign_keys = ON;');
  let txDepth = 0;

  function toLibsqlRow(columns, obj) {
    // @libsql/client Row objects include numeric indices plus `length` and column names.
    const row = Object.assign([], { length: columns.length });
    columns.forEach((col, index) => {
      const value = typeof obj[col] === 'number' && Number.isInteger(obj[col]) ? BigInt(obj[col]) : obj[col];
      row[index] = value;
      row[col] = value;
    });
    return row;
  }

  function wrapError(error) {
    if (error?.errcode === 1555 || error?.errcode === 2067) {
      error.code = 'SQLITE_CONSTRAINT_UNIQUE';
      error.rawCode = error.errcode;
    }
    return error;
  }

  function executeRaw(sqlOrObj) {
    const sql = typeof sqlOrObj === 'string' ? sqlOrObj : sqlOrObj.sql;
    const args = typeof sqlOrObj === 'string' ? [] : (sqlOrObj.args || []);
    if (/^\s*PRAGMA\s+user_version\s*=/i.test(sql)) {
      throw new Error('PRAGMA user_version is read-only on Turso Cloud');
    }
    try {
      const stmt = raw.prepare(sql);
      let columns = [];
      let rows = [];
      let rowsAffected = 0;
      if (/^\s*(SELECT|PRAGMA\b(?!.*=))/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rawRows = stmt.all(...args);
        if (rawRows.length > 0) {
          columns = Object.keys(rawRows[0]);
          rows = rawRows.map(obj => toLibsqlRow(columns, obj));
        }
      } else {
        const result = stmt.run(...args);
        rowsAffected = BigInt(result?.changes ?? 0);
      }
      return { columns, rows, rowsAffected };
    } catch (error) {
      throw wrapError(error);
    }
  }

  return {
    raw,
    async execute(stmt) {
      return executeRaw(stmt);
    },
    async executeMultiple(sql) {
      if (/PRAGMA\s+user_version\s*=/i.test(sql)) {
        throw new Error('PRAGMA user_version is read-only on Turso Cloud');
      }
      try {
        raw.exec(sql);
      } catch (error) {
        throw wrapError(error);
      }
    },
    async transaction(mode) {
      assert.equal(mode, 'write');
      if (txDepth > 0) throw new Error('nested fake transaction');
      txDepth += 1;
      raw.exec('BEGIN IMMEDIATE');
      let finished = false;
      return {
        async execute(stmt) {
          return executeRaw(stmt);
        },
        async executeMultiple(sql) {
          raw.exec(sql);
        },
        async commit() {
          if (!finished) {
            finished = true;
            txDepth -= 1;
            raw.exec('COMMIT');
          }
        },
        async rollback() {
          if (!finished) {
            finished = true;
            txDepth -= 1;
            raw.exec('ROLLBACK');
          }
        },
        close() {
          if (!finished) {
            finished = true;
            txDepth -= 1;
            raw.exec('ROLLBACK');
          }
        },
      };
    },
    close() {
      raw.close();
    },
  };
}

test('remote Turso adapter initializes v4 schema in schema_migrations without writing PRAGMA user_version', async t => {
  const raw = new DatabaseSync(':memory:');
  const client = fakeLibsqlClient(raw);
  const db = await createDatabase({ url: 'libsql://demo-user.turso.io', authToken: 'tok', client });
  t.after(() => db.close());

  assert.equal(db.isRemote, true);
  assert.equal(db.url, 'libsql://demo-user.turso.io');
  assert.equal((await db.get('SELECT MAX(version) AS v FROM schema_migrations')).v, LATEST_VERSION);
  assert.equal((await db.get('PRAGMA user_version')).user_version, 0);

  // Reopening the initialized remote database is a no-op.
  const reopened = await createDatabase({ url: 'https://demo-user.turso.io', authToken: 'tok', client });
  assert.equal((await reopened.get('SELECT MAX(version) AS v FROM schema_migrations')).v, LATEST_VERSION);
});

test('remote Turso adapter normalizes rows, handles interactive transactions and serves full HTTP app flows', async t => {
  const client = fakeLibsqlClient();
  const db = await createDatabase({ url: 'libsql://app-sync.turso.io', authToken: 'tok', client });
  const app = createApp({ db, corsOrigin: 'http://localhost:5173' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    await db.close();
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, { method = 'GET', token, body, expected = 200 } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    assert.equal(res.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  };

  assert.deepEqual(await req('/api/health'), { status: 'ok' });
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Turso Patient', email: 'turso@example.com', password },
    expected: 201,
  });
  assert.equal(reg.user.email, 'turso@example.com');
  assert.equal('0' in reg.user, false);

  // Duplicate email hits LibSQL unique constraint and maps to HTTP 409.
  await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Turso Dup', email: 'TURSO@example.com', password },
    expected: 409,
  });

  // Rollback verification on interactive transaction failure.
  await assert.rejects(db.transaction(async tx => {
    await tx.run("UPDATE users SET name = 'Rolled Back' WHERE id = ?", reg.user.id);
    throw new Error('force rollback');
  }), /force rollback/);
  assert.equal((await db.get('SELECT name FROM users WHERE id = ?', reg.user.id)).name, 'Turso Patient');

  // App workout upload + idempotent retry + progress query all work on remote adapter (BigInt coerced to Number).
  const cid = randomUUID();
  const payload = {
    client_id: cid,
    exercise: 1,
    target_reps: 10,
    repetitions: 10,
    elapsed_seconds: 35,
    before_bpm: 74,
    after_bpm: 102,
    before_skipped: false,
    after_skipped: false,
    started_at: '2026-11-18T12:00:00.000Z',
    ended_at: '2026-11-18T12:00:35.000Z',
  };
  const created = await req('/api/app/sets', { method: 'POST', token: reg.token, body: payload, expected: 201 });
  assert.equal(created.workout.repetitions, 10);
  const dup = await req('/api/app/sets', { method: 'POST', token: reg.token, body: payload, expected: 200 });
  assert.equal(dup.duplicate, true);

  const prog = await req('/api/progress?kind=reps', { token: reg.token });
  assert.equal(prog.completed_workouts, 1);
  assert.equal(prog.total_repetitions, 10);
  assert.equal(typeof prog.total_repetitions, 'number');
});

test('createDatabase validates remote config and keeps explicit paths local', async t => {
  await assert.rejects(createDatabase({ url: 'ftp://bad.example.com', authToken: 'tok' }), /libsql:\/\/, https:\/\/, or http:\/\//);
  await assert.rejects(createDatabase({ url: 'libsql://missing-token.turso.io' }), /TURSO_AUTH_TOKEN/);

  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = 'libsql://should-not-connect.turso.io';
  t.after(() => {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
  });

  const localDb = await createDatabase(':memory:');
  await localDb.close();
  assert.equal(localDb.isRemote, false);
});

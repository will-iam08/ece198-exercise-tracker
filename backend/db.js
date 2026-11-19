import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client/web';
import { migrate } from './migrations.js';

function normalizeParam(value) {
  return value === undefined ? null : value;
}

function normalizeLocalRow(row) {
  if (!row) return undefined;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    out[key] = typeof val === 'bigint' ? Number(val) : val;
  }
  return out;
}

function normalizeRemoteRow(columns, row) {
  if (!row) return undefined;
  const out = {};
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    const val = Object.hasOwn(row, col) ? row[col] : row[i];
    out[col] = typeof val === 'bigint' ? Number(val) : (val === undefined ? null : val);
  }
  return out;
}

function splitSqlStatements(sql) {
  return String(sql)
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);
}

export function wrapLocal(rawDb, label = 'sqlite') {
  let txChain = Promise.resolve();

  function ops() {
    return {
      isRemote: false,
      url: label,
      async get(sql, ...params) {
        return normalizeLocalRow(rawDb.prepare(sql).get(...params.map(normalizeParam)));
      },
      async all(sql, ...params) {
        return rawDb.prepare(sql).all(...params.map(normalizeParam)).map(normalizeLocalRow);
      },
      async run(sql, ...params) {
        const result = rawDb.prepare(sql).run(...params.map(normalizeParam));
        return { changes: Number(result?.changes ?? 0) };
      },
      async exec(sql) {
        rawDb.exec(sql);
      },
    };
  }

  const base = ops();
  const adapter = {
    ...base,
    transaction(fn) {
      const execute = async () => {
        rawDb.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(base);
          rawDb.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            rawDb.exec('ROLLBACK');
          } catch {
            // Transaction may already be rolled back by SQLite on certain errors.
          }
          throw error;
        }
      };
      const next = txChain.then(execute, execute);
      txChain = next.catch(() => {});
      return next;
    },
    async close() {
      rawDb.close();
    },
  };
  return adapter;
}

function validateRemoteUrl(rawUrl, authToken, hasCustomClient) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('TURSO_DATABASE_URL is not a valid URL');
  }
  if (!['libsql:', 'https:', 'http:'].includes(parsed.protocol) || !parsed.host) {
    throw new Error('TURSO_DATABASE_URL must use libsql://, https://, or http://');
  }
  if (!hasCustomClient && parsed.protocol !== 'http:' && !authToken) {
    throw new Error('TURSO_AUTH_TOKEN must be set when using a remote TURSO_DATABASE_URL');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function wrapRemote(client, label = 'turso') {
  let txChain = Promise.resolve();

  function makeExecutor(target) {
    return {
      isRemote: true,
      url: label,
      async get(sql, ...params) {
        const rs = await target.execute({ sql, args: params.map(normalizeParam) });
        return rs.rows.length > 0 ? normalizeRemoteRow(rs.columns, rs.rows[0]) : undefined;
      },
      async all(sql, ...params) {
        const rs = await target.execute({ sql, args: params.map(normalizeParam) });
        return rs.rows.map(row => normalizeRemoteRow(rs.columns, row));
      },
      async run(sql, ...params) {
        const rs = await target.execute({ sql, args: params.map(normalizeParam) });
        return { changes: Number(rs.rowsAffected ?? 0) };
      },
      async exec(sql) {
        if (typeof target.executeMultiple === 'function') {
          await target.executeMultiple(sql);
          return;
        }
        for (const stmt of splitSqlStatements(sql)) {
          await target.execute(stmt);
        }
      },
    };
  }

  const base = makeExecutor(client);
  return {
    ...base,
    transaction(fn) {
      const execute = async () => {
        const rawTx = await client.transaction('write');
        const txAdapter = makeExecutor(rawTx);
        try {
          const result = await fn(txAdapter);
          await rawTx.commit();
          return result;
        } catch (error) {
          try {
            await rawTx.rollback();
          } catch {
            // Ignore rollback errors if connection closed mid-transaction.
          }
          throw error;
        } finally {
          rawTx.close?.();
        }
      };
      const next = txChain.then(execute, execute);
      txChain = next.catch(() => {});
      return next;
    },
    async close() {
      await client.close?.();
    },
  };
}

// Explicit string paths (e.g. ':memory:' or temp test paths) always open local SQLite
// and ignore TURSO_DATABASE_URL so tests remain hermetic and offline.
export async function createDatabase(pathOrOptions) {
  const remoteConfig = typeof pathOrOptions === 'object' && pathOrOptions !== null
    ? pathOrOptions
    : (pathOrOptions === undefined && process.env.TURSO_DATABASE_URL?.trim()
      ? {
        url: process.env.TURSO_DATABASE_URL.trim(),
        authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
      }
      : null);

  let adapter;
  if (remoteConfig) {
    const label = validateRemoteUrl(remoteConfig.url, remoteConfig.authToken, Boolean(remoteConfig.client));
    const client = remoteConfig.client ?? createClient({
      url: remoteConfig.url,
      authToken: remoteConfig.authToken,
    });
    adapter = wrapRemote(client, label);
    try {
      await adapter.exec('PRAGMA foreign_keys = ON;');
      await migrate(adapter);
      return adapter;
    } catch (error) {
      await adapter.close();
      throw error;
    }
  }

  const path = typeof pathOrOptions === 'string'
    ? pathOrOptions
    : (process.env.DATABASE_PATH || './data/ece198.sqlite');
  const filename = path === ':memory:' ? path : resolve(path);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const rawDb = new DatabaseSync(filename);
  adapter = wrapLocal(rawDb, filename);
  try {
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    await adapter.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (filename !== ':memory:') await adapter.exec('PRAGMA journal_mode = WAL;');
    await migrate(adapter);
    return adapter;
  } catch (error) {
    await adapter.close();
    throw error;
  }
}

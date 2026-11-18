import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';

export function createDatabase(path = process.env.DATABASE_PATH || './data/ece198.sqlite') {
  const filename = path === ':memory:' ? path : resolve(path);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
    db.exec(`BEGIN;\n${readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')}\nCOMMIT;`);
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

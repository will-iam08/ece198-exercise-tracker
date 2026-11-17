import { createDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
const origin = new URL(corsOrigin);
if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== corsOrigin) {
  throw new Error('CORS_ORIGIN must be one exact http(s) origin without a trailing slash');
}
const db = createDatabase();
const server = createApp({ db, corsOrigin }).listen(port, host, () => {
  console.log(`ECE 198 backend listening on http://${host}:${port}`);
});
server.on('error', error => {
  console.error(`Server failed: ${error.message}`);
  db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => db.close()));
}

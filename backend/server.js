import { fileURLToPath } from 'node:url';
import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { DEFAULT_CORS_ORIGINS, imapSettings, parseCorsOrigins } from './config.js';
import { startImapPoller } from './emailBot.js';

const port = Number(process.env.PORT || 3000);
// 127.0.0.1 keeps the API on this computer; HOST=0.0.0.0 lets the ESP32 and
// other devices on the same network reach it.
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGINS);
if (process.env.RENDER_EXTERNAL_URL) {
  const renderOrigin = new URL(process.env.RENDER_EXTERNAL_URL).origin;
  if (!corsOrigins.includes(renderOrigin)) corsOrigins.push(renderOrigin);
}
const staticDir = fileURLToPath(new URL('../frontend/dist', import.meta.url));
const imap = imapSettings();
const bot = {
  webhookSecret: process.env.BOT_WEBHOOK_SECRET || '',
  address: process.env.BOT_EMAIL_ADDRESS || imap?.user || '',
};
if (bot.webhookSecret && bot.webhookSecret.length < 16) throw new Error('BOT_WEBHOOK_SECRET must contain at least 16 characters');

const db = await createDatabase();
const server = createApp({ db, corsOrigin: corsOrigins, bot, staticDir }).listen(port, host, () => {
  console.log(`ECE 198 backend listening on http://${host}:${port}`);
  console.log(`Database storage: ${db.isRemote ? `Turso (${db.url})` : 'local SQLite'}`);
  console.log(`Browser origins allowed: ${corsOrigins.join(', ')}`);
  if (bot.webhookSecret) console.log('Email bot webhook enabled at POST /api/bot/inbound-email');
  if (imap) console.log(`Email bot checking ${imap.user} on ${imap.host} every ${imap.intervalMs / 1000} s`);
});
const poller = imap ? startImapPoller(db, imap) : null;
server.on('error', error => {
  console.error(`Server failed: ${error.message}`);
  poller?.stop();
  void db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    poller?.stop();
    server.close(() => { void db.close(); });
  });
}

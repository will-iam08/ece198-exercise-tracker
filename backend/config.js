// Settings read from the environment by server.js, kept here so tests can
// check the parsing without starting a server.

// The Vite dev server on this computer, by name or by address.
export const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

// CORS_ORIGIN: one exact http(s) origin or a comma-separated list of them,
// each without a path or trailing slash. An array is accepted as-is.
export function parseCorsOrigins(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const origins = list.map(item => String(item).trim()).filter(Boolean);
  if (origins.length === 0) throw new Error('CORS_ORIGIN must list at least one origin');
  for (const item of origins) {
    let origin;
    try {
      origin = new URL(item);
    } catch {
      throw new Error(`CORS_ORIGIN entry "${item}" is not a valid URL`);
    }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== item) {
      throw new Error(`CORS_ORIGIN entry "${item}" must be an exact http(s) origin without a path or trailing slash`);
    }
  }
  return [...new Set(origins)];
}

// The optional IMAP mailbox the email bot reads. Returns null unless host,
// user and password are all set, so the poller is off by default.
export function imapSettings(env = process.env) {
  if (!env.BOT_IMAP_HOST || !env.BOT_IMAP_USER || !env.BOT_IMAP_PASS) return null;
  const port = Number(env.BOT_IMAP_PORT || 993);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BOT_IMAP_PORT must be an integer from 1 to 65535');
  const seconds = Number(env.BOT_IMAP_POLL_SECONDS || 60);
  if (!Number.isInteger(seconds) || seconds < 15 || seconds > 3600) {
    throw new Error('BOT_IMAP_POLL_SECONDS must be an integer from 15 to 3600');
  }
  return {
    host: env.BOT_IMAP_HOST,
    port,
    secure: env.BOT_IMAP_TLS !== 'false',
    user: env.BOT_IMAP_USER,
    pass: env.BOT_IMAP_PASS,
    mailbox: env.BOT_IMAP_MAILBOX || 'INBOX',
    intervalMs: seconds * 1000,
  };
}

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { bodyFields, fail } from './validate.js';

// The email bot turns an email from a registered patient into a message in
// their doctors' inbox. Mail reaches it in one of two ways:
//   1. a mail service POSTs { from, subject, text } to /api/bot/inbound-email
//      with the shared secret in the X-Bot-Secret header, or
//   2. the optional IMAP poller reads unread mail from a mailbox.
// Both go through ingestEmail, so they store exactly the same thing.

export const MAX_SUBJECT = 200;
export const MAX_BODY = 4000;
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// "Jane Doe <Jane@Example.com>", "<jane@example.com>" or "jane@example.com"
// -> { name: 'Jane Doe', email: 'jane@example.com' }, or null when there is no address.
export function parseAddress(from) {
  if (typeof from !== 'string') return null;
  const value = from.trim();
  const angle = /^(.*?)<([^<>]+)>\s*$/.exec(value);
  const address = (angle ? angle[2] : value).trim().toLowerCase();
  if (address.length > 254 || !EMAIL_PATTERN.test(address)) return null;
  const name = angle ? angle[1].trim().replace(/^"(.*)"$/, '$1').trim() : '';
  return { name, email: address };
}

function cleanSubject(subject) {
  const value = typeof subject === 'string' ? subject.replace(/\s+/g, ' ').trim() : '';
  return (value || '(no subject)').slice(0, MAX_SUBJECT);
}

// Long emails (for example with a quoted thread underneath) are cut to the
// length the inbox stores rather than refused.
function cleanBody(text) {
  if (typeof text !== 'string') return '';
  const value = text.replace(/\r\n?/g, '\n').trim();
  return value.length > MAX_BODY ? value.slice(0, MAX_BODY).trimEnd() : value;
}

// Stores one email. Returns { stored: true, message } for a registered
// patient, or { stored: false, reason } when the sender is unknown or the
// email has no text. Nothing is stored for unknown senders.
export function ingestEmail(db, { from, subject, text }, now = new Date().toISOString()) {
  const sender = parseAddress(from);
  if (!sender) return { stored: false, reason: 'invalid_sender' };
  const patient = db.prepare("SELECT id FROM users WHERE email = ? AND role = 'participant'").get(sender.email);
  if (!patient) return { stored: false, reason: 'unknown_sender' };
  const body = cleanBody(text);
  if (!body) return { stored: false, reason: 'empty_body' };
  const id = randomUUID();
  db.prepare(`INSERT INTO patient_messages (id, participant_id, sender_email, subject, body, source, received_at)
    VALUES (?, ?, ?, ?, ?, 'email_bot', ?)`).run(id, patient.id, sender.email, cleanSubject(subject), body, now);
  return { stored: true, message: db.prepare('SELECT * FROM patient_messages WHERE id = ?').get(id) };
}

// Compares two secrets in constant time (hashing first makes the lengths equal).
export function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export function registerBotRoutes(app, { db, webhookSecret }) {
  app.post('/api/bot/inbound-email', (req, res) => {
    // Without BOT_WEBHOOK_SECRET the route does not exist.
    if (!webhookSecret) fail(404, 'Route not found');
    if (!secretMatches(req.get('X-Bot-Secret'), webhookSecret)) fail(401, 'Bot secret is missing or incorrect');
    bodyFields(req.body, ['from', 'text'], ['subject']);
    if (typeof req.body.from !== 'string') fail(400, 'from must be a string');
    if (typeof req.body.text !== 'string') fail(400, 'text must be a string');
    if (req.body.subject !== undefined && typeof req.body.subject !== 'string') fail(400, 'subject must be a string');
    const result = ingestEmail(db, req.body);
    if (result.stored) return res.status(201).json({ stored: true, message_id: result.message.id });
    if (result.reason === 'empty_body') fail(400, 'text must contain the message');
    // Unknown and unreadable senders are accepted but not stored, so the mail
    // service does not keep retrying them.
    return res.status(202).json({ stored: false });
  });
}

// ---------- Optional IMAP poller ----------

// The first plain-text part of a message (or its HTML part if there is no
// plain text), skipping attachments. Returns { part, html } or null.
export function findTextPart(node) {
  let html = null;
  function walk(item) {
    if (!item) return null;
    if (Array.isArray(item.childNodes) && item.childNodes.length) {
      for (const child of item.childNodes) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    if (item.disposition === 'attachment') return null;
    const part = item.part || '1';
    if (item.type === 'text/plain') return { part, html: false };
    if (item.type === 'text/html' && !html) html = { part, html: true };
    return null;
  }
  return walk(node) || html;
}

// A rough plain-text version of an HTML email body.
export function htmlToText(html) {
  return String(html)
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

async function readStream(stream, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.length;
    if (size >= maxBytes) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

// One pass over the mailbox with a connected ImapFlow-style client: every
// unread message is passed to `ingest` and then marked as read, whether or
// not it was stored, so an email is never processed twice.
export async function pollMailbox(client, { mailbox = 'INBOX', ingest, maxBytes = 64 * 1024 }) {
  const counts = { stored: 0, ignored: 0 };
  const lock = await client.getMailboxLock(mailbox);
  try {
    const unread = [];
    for await (const message of client.fetch({ seen: false }, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
      unread.push(message);
    }
    for (const message of unread) {
      const uid = String(message.uid);
      const sender = message.envelope?.from?.[0];
      const from = sender?.address ? (sender.name ? `${sender.name} <${sender.address}>` : sender.address) : '';
      let text = '';
      const found = findTextPart(message.bodyStructure);
      if (found) {
        const { content } = await client.download(uid, found.part, { uid: true, maxBytes });
        text = await readStream(content, maxBytes);
        if (found.html) text = htmlToText(text);
      }
      const result = ingest({ from, subject: message.envelope?.subject ?? '', text });
      counts[result.stored ? 'stored' : 'ignored'] += 1;
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    }
  } finally {
    lock.release();
  }
  return counts;
}

async function createImapClient(settings) {
  let ImapFlow;
  try {
    ({ ImapFlow } = await import('imapflow'));
  } catch {
    throw new Error('the imapflow package is not installed (run npm install in backend/)');
  }
  const client = new ImapFlow({
    host: settings.host, port: settings.port, secure: settings.secure,
    auth: { user: settings.user, pass: settings.pass }, logger: false,
  });
  // Connection errors are reported by the failed call; without a listener
  // an 'error' event would stop the whole server.
  client.on('error', () => {});
  return client;
}

// Checks the mailbox now and then every settings.intervalMs. Only started by
// server.js when BOT_IMAP_HOST, BOT_IMAP_USER and BOT_IMAP_PASS are all set.
// Log lines never include the password.
export function startImapPoller(db, settings, { createClient = createImapClient, log = console } = {}) {
  let stopped = false;
  let timer;
  async function tick() {
    let client;
    try {
      client = await createClient(settings);
      await client.connect();
      const counts = await pollMailbox(client, { mailbox: settings.mailbox, ingest: email => ingestEmail(db, email) });
      if (counts.stored || counts.ignored) {
        log.log(`Email bot: ${counts.stored} message(s) stored, ${counts.ignored} ignored (unknown sender or empty).`);
      }
    } catch (error) {
      log.error(`Email bot: could not check ${settings.user} on ${settings.host}: ${error.message}`);
    } finally {
      try { await client?.logout(); } catch { /* already closed */ }
    }
    if (!stopped) timer = setTimeout(tick, settings.intervalMs);
  }
  tick();
  return { stop() { stopped = true; clearTimeout(timer); } };
}

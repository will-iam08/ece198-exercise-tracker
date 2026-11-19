import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDatabase } from '../db.js';
import {
  describeCredential, findTextPart, fromCloudMailin, htmlToText, ingestEmail, isCloudMailin, parseAddress, pollMailbox, requestSecret, secretMatches,
  startImapPoller,
} from '../emailBot.js';
import { imapSettings, parseCorsOrigins } from '../config.js';
import { fixture } from './fixture.js';

const secret = 'test-bot-secret-0123456789';

test('parseAddress reads display-name and bare addresses', () => {
  assert.deepEqual(parseAddress('Jane Doe <Jane.Doe@Example.com>'), { name: 'Jane Doe', email: 'jane.doe@example.com' });
  assert.deepEqual(parseAddress('"Doe, Jane" <jane@example.com>'), { name: 'Doe, Jane', email: 'jane@example.com' });
  assert.deepEqual(parseAddress('<jane@example.com>'), { name: '', email: 'jane@example.com' });
  assert.deepEqual(parseAddress('  JANE@example.com '), { name: '', email: 'jane@example.com' });
  for (const bad of ['', 'Jane Doe', 'Jane <not-an-address>', 'a@b', null, 42, `${'x'.repeat(250)}@example.com`]) {
    assert.equal(parseAddress(bad), null, String(bad));
  }
});

test('secretMatches compares exactly', () => {
  assert.equal(secretMatches(secret, secret), true);
  assert.equal(secretMatches(`${secret}x`, secret), false);
  assert.equal(secretMatches('', secret), false);
  assert.equal(secretMatches(undefined, secret), false);
  assert.equal(secretMatches(secret, ''), false);
});

test('the inbound-email webhook needs the secret, matches patients case-insensitively, and ignores unknown senders', async t => {
  const f = await fixture(t, ':memory:', { bot: { webhookSecret: secret, address: 'bot@clinic.example' } });
  const pat = await f.register('pat.smith@example.com');
  await f.staff('doc@example.com', [pat.user.id]);
  const post = (body, { key = secret, status = 201 } = {}) => f.request('/api/bot/inbound-email', {
    method: 'POST', body, status, headers: key === null ? {} : { 'X-Bot-Secret': key },
  });
  const email = { from: 'Pat Smith <PAT.Smith@Example.COM>', subject: 'Sore wrist', text: 'My wrist hurts after the curls.\r\n' };
  const count = async () => (await f.db.get('SELECT COUNT(*) AS n FROM patient_messages')).n;

  await post(email, { key: null, status: 401 });
  await post(email, { key: 'wrong-secret-0123456789', status: 401 });
  assert.equal(await count(), 0);

  const stored = (await post(email)).data;
  assert.equal(stored.stored, true);
  const row = await f.db.get('SELECT * FROM patient_messages WHERE id = ?', stored.message_id);
  assert.equal(row.participant_id, pat.user.id);
  assert.equal(row.sender_email, 'pat.smith@example.com');
  assert.equal(row.subject, 'Sore wrist');
  assert.equal(row.body, 'My wrist hurts after the curls.');
  assert.equal(row.source, 'email_bot');
  assert.equal(row.is_read, 0);

  assert.deepEqual((await post({ ...email, from: 'Stranger <stranger@example.com>' }, { status: 202 })).data, { stored: false });
  assert.deepEqual((await post({ ...email, from: 'doc@example.com' }, { status: 202 })).data, { stored: false });
  assert.deepEqual((await post({ ...email, from: 'nonsense' }, { status: 202 })).data, { stored: false });
  assert.equal(await count(), 1);

  await post({ ...email, text: '   ' }, { status: 400 });
  await post({ from: email.from }, { status: 400 });
  await post({ ...email, extra: 1 }, { status: 400 });
  // Long emails are cut to the stored length; a missing subject gets a placeholder.
  const long = (await post({ from: 'pat.smith@example.com', text: 'y'.repeat(9000) })).data;
  const longRow = await f.db.get('SELECT * FROM patient_messages WHERE id = ?', long.message_id);
  assert.equal(longRow.body.length, 4000);
  assert.equal(longRow.subject, '(no subject)');

  assert.deepEqual((await f.request('/api/bot/info', { token: pat.token })).data, { address: 'bot@clinic.example', email: 'pat.smith@example.com' });
});

// A trimmed CloudMailin "JSON (Normalized)" body, shaped like their documented example.
function cloudMailinEmail({ from = 'Pat Smith <Pat.Smith@Example.com>', subject = 'Question about rows', plain = 'Is 120 bpm after the row okay?\n', ...rest } = {}) {
  return {
    headers: { return_path: 'bounce-123@mail.example.com', from, to: 'abc123@cloudmailin.net', subject, date: 'Mon, 16 Nov 2026 17:00:01 +0000' },
    envelope: { to: 'abc123@cloudmailin.net', from: 'bounce-123@mail.example.com', recipients: ['abc123@cloudmailin.net'], spf: { result: 'pass', domain: 'example.com' }, tls: true },
    plain,
    html: `<p>${plain}</p>`,
    attachments: [],
    ...rest,
  };
}

test('CloudMailin bodies and Bearer secrets are read correctly', () => {
  assert.equal(isCloudMailin(cloudMailinEmail()), true);
  for (const other of [{ from: 'a@example.com', text: 'hi' }, { headers: {}, envelope: [] }, null, [], 'text']) {
    assert.equal(isCloudMailin(other), false, JSON.stringify(other));
  }
  assert.deepEqual(fromCloudMailin(cloudMailinEmail()), {
    from: 'Pat Smith <Pat.Smith@Example.com>', subject: 'Question about rows', text: 'Is 120 bpm after the row okay?\n',
  });
  // The extracted reply wins over the full text with the quoted thread.
  assert.equal(fromCloudMailin(cloudMailinEmail({ reply_plain: 'Yes please.', plain: 'Yes please.\n\n> earlier message' })).text, 'Yes please.');
  // HTML is used only when there is no plain text.
  assert.equal(fromCloudMailin(cloudMailinEmail({ plain: '', html: '<p>Only <b>HTML</b></p>' })).text.trim(), 'Only HTML');
  // Without a From header the envelope sender is used.
  const noHeader = cloudMailinEmail();
  delete noHeader.headers.from;
  assert.equal(fromCloudMailin(noHeader).from, 'bounce-123@mail.example.com');
  // A repeated header arrives as an array; the first value is used.
  assert.equal(fromCloudMailin(cloudMailinEmail({ subject: ['First', 'Second'] })).subject, 'First');

  const req = headers => ({ get: name => headers[name.toLowerCase()] });
  assert.equal(requestSecret(req({ 'x-bot-secret': 'abc' })), 'abc');
  assert.equal(requestSecret(req({ authorization: 'Bearer abc' })), 'abc');
  assert.equal(requestSecret(req({ authorization: 'bearer  abc ' })), 'abc');
  assert.equal(requestSecret(req({ authorization: 'Basic YWJj' })), undefined);
  assert.equal(requestSecret(req({})), undefined);
  // An explicit X-Bot-Secret is never overridden by the Authorization header.
  assert.equal(requestSecret(req({ 'x-bot-secret': 'wrong', authorization: `Bearer ${secret}` })), 'wrong');

  // The rejection log describes the credential without revealing it.
  assert.equal(describeCredential(req({})), 'no X-Bot-Secret header, Authorization header or secret query parameter');
  assert.equal(describeCredential(req({ 'x-bot-secret': 'abc' })), 'X-Bot-Secret header (3 characters)');
  assert.equal(describeCredential(req({ authorization: `Bearer ${secret}` })), `Authorization header, scheme "Bearer", ${secret.length} characters after it`);
  assert.equal(describeCredential(req({ authorization: secret })), `Authorization header with no scheme (${secret.length} characters)`);
  assert.ok(!describeCredential(req({ authorization: `Bearer ${secret}` })).includes(secret));
});

test('the webhook accepts CloudMailin emails with a Bearer secret', async t => {
  const f = await fixture(t, ':memory:', { bot: { webhookSecret: secret, address: 'abc123@cloudmailin.net' } });
  const pat = await f.register('pat.smith@example.com');
  const doctor = await f.staff('doc@example.com', [pat.user.id]);
  const post = (body, { auth = `Bearer ${secret}`, status = 201 } = {}) => f.request('/api/bot/inbound-email', {
    method: 'POST', body, status, headers: auth === null ? {} : { Authorization: auth },
  });
  const count = async () => (await f.db.get('SELECT COUNT(*) AS n FROM patient_messages')).n;

  await post(cloudMailinEmail(), { auth: null, status: 401 });
  await post(cloudMailinEmail(), { auth: 'Bearer wrong-secret-0123456789', status: 401 });
  await post(cloudMailinEmail(), { auth: secret, status: 401 });
  assert.equal(await count(), 0);

  const stored = (await post(cloudMailinEmail())).data;
  assert.equal(stored.stored, true);
  const row = await f.db.get('SELECT * FROM patient_messages WHERE id = ?', stored.message_id);
  assert.equal(row.participant_id, pat.user.id);
  assert.equal(row.sender_email, 'pat.smith@example.com');
  assert.equal(row.subject, 'Question about rows');
  assert.equal(row.body, 'Is 120 bpm after the row okay?');
  assert.equal(row.source, 'email_bot');

  // Unknown senders are accepted but not stored, so CloudMailin does not retry.
  assert.deepEqual((await post(cloudMailinEmail({ from: 'Stranger <stranger@example.com>' }), { status: 202 })).data, { stored: false });
  // An email with no text at all is refused.
  await post(cloudMailinEmail({ plain: '', html: '' }), { status: 400 });
  // Extra CloudMailin fields (attachments, reply_plain, ...) are fine; a large email still fits.
  const big = cloudMailinEmail({ attachments: [{ file_name: 'scan.pdf', content_type: 'application/pdf', size: 600000, content: 'A'.repeat(600000) }] });
  assert.equal((await post(big)).data.stored, true);
  assert.equal(await count(), 2);

  // The doctor sees the email in the inbox.
  const inbox = (await f.request('/api/doctor/messages', { token: doctor.token })).data;
  assert.equal(inbox.messages.length, 2);
  assert.ok(inbox.messages.every(message => message.source === 'email_bot'));
});

test('the secret can come from the ?secret= query parameter, after both headers', () => {
  const req = (headers, query = {}) => ({ get: name => headers[name.toLowerCase()], query });
  assert.equal(requestSecret(req({}, { secret })), secret);
  assert.equal(requestSecret(req({}, { secret: '' })), '');
  // Other query parameters are ignored.
  assert.equal(requestSecret(req({}, { secret, utm_source: 'mail', page: '2' })), secret);
  assert.equal(requestSecret(req({}, { token: secret })), undefined);
  // A repeated ?secret= is ambiguous and is refused.
  assert.equal(requestSecret(req({}, { secret: [secret, secret] })), undefined);
  // Without a parsed query (no query string) there is simply no secret.
  assert.equal(requestSecret({ get: () => undefined }), undefined);
  // An explicit header wins over the query parameter, even when it is wrong.
  assert.equal(requestSecret(req({ 'x-bot-secret': 'wrong' }, { secret })), 'wrong');
  assert.equal(requestSecret(req({ 'x-bot-secret': '' }, { secret })), '');
  assert.equal(requestSecret(req({ authorization: 'Bearer wrong' }, { secret })), 'wrong');
  // A non-Bearer Authorization header carries no bot secret, so the query parameter is used.
  assert.equal(requestSecret(req({ authorization: 'Basic YWJj' }, { secret })), secret);

  // The rejection log reports a query secret by length only.
  assert.equal(describeCredential(req({}, { secret })), `secret query parameter (${secret.length} characters)`);
  assert.equal(describeCredential(req({}, { secret: [secret, 'x'] })), 'secret query parameter given 2 times');
  assert.equal(describeCredential(req({}, { page: '2' })), 'no X-Bot-Secret header, Authorization header or secret query parameter');
  assert.equal(describeCredential(req({ 'x-bot-secret': 'abc' }, { secret })),
    `X-Bot-Secret header (3 characters); secret query parameter (${secret.length} characters)`);
  assert.equal(describeCredential(req({ authorization: 'Basic YWJj' }, { secret })),
    `Authorization header, scheme "Basic", 4 characters after it; secret query parameter (${secret.length} characters)`);
  for (const value of [secret, [secret, secret]]) {
    assert.ok(!describeCredential(req({ authorization: `Bearer ${secret}` }, { secret: value })).includes(secret));
  }
});

test('the webhook accepts CloudMailin emails with the secret in the target URL', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  const f = await fixture(t, ':memory:', { bot: { webhookSecret: secret, address: 'abc123@cloudmailin.net' } });
  const pat = await f.register('pat.smith@example.com');
  const doctor = await f.staff('doc@example.com', [pat.user.id]);
  const post = (query, body, { status = 201, headers = {} } = {}) => f.request(`/api/bot/inbound-email${query}`, {
    method: 'POST', body, status, headers,
  });
  const count = async () => (await f.db.get('SELECT COUNT(*) AS n FROM patient_messages')).n;
  const q = value => `?secret=${encodeURIComponent(value)}`;

  // Missing, wrong, empty and repeated query secrets are refused.
  await post('', cloudMailinEmail(), { status: 401 });
  await post('?page=2', cloudMailinEmail(), { status: 401 });
  await post(q('wrong-secret-0123456789'), cloudMailinEmail(), { status: 401 });
  await post('?secret=', cloudMailinEmail(), { status: 401 });
  await post(`${q(secret)}&${q(secret).slice(1)}`, cloudMailinEmail(), { status: 401 });
  // A wrong header is not rescued by a correct query secret.
  await post(q(secret), cloudMailinEmail(), { status: 401, headers: { 'X-Bot-Secret': 'wrong-secret-0123456789' } });
  await post(q(secret), cloudMailinEmail(), { status: 401, headers: { Authorization: 'Bearer wrong-secret-0123456789' } });
  assert.equal(await count(), 0);

  // The rejection log says what arrived without ever printing the secret.
  assert.equal(warnings.length, 7);
  assert.equal(warnings[0], 'Email bot webhook rejected: no X-Bot-Secret header, Authorization header or secret query parameter');
  assert.equal(warnings[2], 'Email bot webhook rejected: secret query parameter (23 characters)');
  assert.ok(warnings.every(line => !line.includes(secret)), warnings.join('\n'));

  const stored = (await post(q(secret), cloudMailinEmail())).data;
  assert.equal(stored.stored, true);
  const row = await f.db.get('SELECT * FROM patient_messages WHERE id = ?', stored.message_id);
  assert.equal(row.participant_id, pat.user.id);
  assert.equal(row.subject, 'Question about rows');
  assert.equal(row.body, 'Is 120 bpm after the row okay?');
  assert.equal(row.source, 'email_bot');
  // Unknown query parameters around the secret change nothing.
  assert.equal((await post(`?utm_source=mail${q(secret).replace('?', '&')}&x=1`, cloudMailinEmail())).data.stored, true);
  // A non-Bearer Authorization header does not hide the query secret.
  assert.equal((await post(q(secret), cloudMailinEmail(), { headers: { Authorization: 'Basic dXNlcjpwYXNz' } })).data.stored, true);

  // Unknown senders are accepted but not stored, so CloudMailin does not retry.
  assert.deepEqual((await post(q(secret), cloudMailinEmail({ from: 'Stranger <stranger@example.com>' }), { status: 202 })).data, { stored: false });
  assert.equal(await count(), 3);
  assert.equal(warnings.length, 7);
  assert.equal((await f.request('/api/doctor/messages', { token: doctor.token })).data.messages.length, 3);
});

test('the webhook does not exist without BOT_WEBHOOK_SECRET', async t => {
  const f = await fixture(t);
  await f.request('/api/bot/inbound-email', {
    method: 'POST', headers: { 'X-Bot-Secret': '' }, body: { from: 'a@example.com', text: 'hi' }, status: 404,
  });
  const pat = await f.register();
  assert.equal((await f.request('/api/bot/info', { token: pat.token })).data.address, null);
});

test('patient questions reach only the assigned doctors, who can mark them read and reply', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice@example.com');
  const bob = await f.register('bob@example.com');
  const doctor = await f.staff('doc@example.com', [alice.user.id]);
  const other = await f.staff('other@example.com', [bob.user.id]);
  const admin = await f.admin();

  await f.request('/api/messages', { method: 'POST', token: alice.token, body: { body: '   ' }, status: 400 });
  await f.request('/api/messages', { method: 'POST', token: alice.token, body: { body: 'x'.repeat(4001) }, status: 400 });
  await f.request('/api/messages', { method: 'POST', token: alice.token, body: { subject: 'x'.repeat(201), body: 'Hi' }, status: 400 });
  await f.request('/api/messages', { method: 'POST', token: doctor.token, body: { body: 'Hi' }, status: 403 });
  const first = (await f.request('/api/messages', { method: 'POST', token: alice.token, body: { subject: 'Reps', body: 'Can I do 15 reps?' }, status: 201 })).data.message;
  assert.equal(first.source, 'portal');
  assert.equal(first.sender_email, 'alice@example.com');
  assert.equal(first.is_read, false);
  await ingestEmail(f.db, { from: 'Alice <ALICE@example.com>', subject: 'Second', text: 'Also, my heart rate was high.' }, new Date(Date.now() + 1000).toISOString());
  await f.request('/api/messages', { method: 'POST', token: bob.token, body: { body: 'Bob here' }, status: 201 });

  const inbox = (await f.request('/api/doctor/messages', { token: doctor.token })).data;
  assert.equal(inbox.unread_count, 2);
  assert.deepEqual(inbox.messages.map(m => m.subject), ['Second', 'Reps']);
  assert.equal(inbox.messages[0].participant_name, 'Test participant');
  assert.equal(inbox.messages[0].participant_email, 'alice@example.com');
  assert.equal(inbox.messages[0].active_session_id, null);
  assert.equal(inbox.messages[0].source, 'email_bot');
  assert.deepEqual((await f.request('/api/doctor/messages', { token: other.token })).data.messages.map(m => m.body), ['Bob here']);
  await f.request('/api/doctor/messages', { token: alice.token, status: 403 });
  await f.request('/api/doctor/messages', { token: admin.token, status: 403 });
  await f.request('/api/doctor/messages?unread_only=yes', { token: doctor.token, status: 400 });

  // Only an assigned doctor may change a message; others get 404.
  const patch = (token, body, status = 200) => f.request(`/api/doctor/messages/${first.id}`, { method: 'PATCH', token, body, status });
  await patch(other.token, { is_read: true }, 404);
  await patch(alice.token, { is_read: true }, 403);
  await patch(doctor.token, {}, 400);
  await patch(doctor.token, { is_read: 'yes' }, 400);
  await patch(doctor.token, { doctor_reply: ' ' }, 400);
  await f.request('/api/doctor/messages/no-such-id', { method: 'PATCH', token: doctor.token, body: { is_read: true }, status: 404 });
  assert.equal((await patch(doctor.token, { is_read: true })).data.message.is_read, true);
  assert.equal((await f.request('/api/doctor/messages?unread_only=1', { token: doctor.token })).data.messages.length, 1);
  assert.equal((await patch(doctor.token, { is_read: false })).data.message.is_read, false);
  const replied = (await patch(doctor.token, { doctor_reply: '  Yes, 15 is fine.  ' })).data.message;
  assert.equal(replied.doctor_reply, 'Yes, 15 is fine.');
  assert.equal(replied.replied_by_name, 'Exercise staff');
  assert.ok(replied.replied_at);
  assert.equal(replied.is_read, true);

  const mine = (await f.request('/api/messages', { token: alice.token })).data.messages;
  assert.deepEqual(mine.map(m => [m.subject, m.doctor_reply]), [['Second', null], ['Reps', 'Yes, 15 is fine.']]);
  assert.deepEqual((await f.request('/api/messages', { token: bob.token })).data.messages.map(m => m.body), ['Bob here']);
  await f.request('/api/messages', { token: doctor.token, status: 403 });
  assert.equal((await f.request('/api/admin/overview', { token: admin.token })).data.stats.unread_messages, 2);

  // After unassignment the doctor no longer sees or changes the patient's messages.
  await f.db.run('DELETE FROM staff_participants WHERE staff_id = ?', doctor.id);
  assert.deepEqual((await f.request('/api/doctor/messages', { token: doctor.token })).data, { messages: [], unread_count: 0 });
  await patch(doctor.token, { is_read: true }, 404);
});

// A stand-in for an ImapFlow client, so the poller is tested without a network.
function fakeMailbox(messages) {
  const seen = [];
  const released = [];
  return {
    seen, released,
    async getMailboxLock(name) { return { release: () => released.push(name) }; },
    async *fetch(query, fields, options) {
      assert.deepEqual(query, { seen: false });
      assert.equal(options.uid, true);
      for (const message of messages) yield message;
    },
    async download(uid, part) {
      const message = messages.find(item => String(item.uid) === uid);
      return { content: Readable.from([Buffer.from(message.parts[part], 'utf8')]) };
    },
    async messageFlagsAdd(uid, flags) { seen.push([uid, flags]); },
  };
}

test('the IMAP poller stores mail from patients and marks every unread email as read', async t => {
  const db = await createDatabase(':memory:');
  t.after(() => db.close());
  await db.run("INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES ('p1','Pat','pat@example.com','x','participant','2026-01-01')");
  const client = fakeMailbox([
    {
      uid: 7, envelope: { from: [{ name: 'Pat', address: 'PAT@example.com' }], subject: 'Plain' },
      bodyStructure: { type: 'multipart/mixed', childNodes: [
        { part: '1', type: 'text/plain' }, { part: '2', type: 'text/plain', disposition: 'attachment' },
      ] },
      parts: { 1: 'Hello from email.', 2: 'attachment text' },
    },
    {
      uid: 8, envelope: { from: [{ address: 'pat@example.com' }], subject: 'Html only' },
      bodyStructure: { type: 'text/html' },
      parts: { 1: '<p>Line one</p><p>Fish &amp; chips</p>' },
    },
    {
      uid: 9, envelope: { from: [{ name: 'Spam', address: 'spam@example.com' }], subject: 'Buy now' },
      bodyStructure: { type: 'text/plain' }, parts: { 1: 'Offer' },
    },
  ]);
  const counts = await pollMailbox(client, { mailbox: 'INBOX', ingest: email => ingestEmail(db, email) });
  assert.deepEqual(counts, { stored: 2, ignored: 1 });
  assert.deepEqual(client.seen.map(([uid]) => uid), ['7', '8', '9']);
  assert.deepEqual(client.released, ['INBOX']);
  const rows = (await db.all('SELECT subject, body, source FROM patient_messages ORDER BY subject')).map(row => ({ ...row }));
  assert.deepEqual(rows, [
    { subject: 'Html only', body: 'Line one\nFish & chips', source: 'email_bot' },
    { subject: 'Plain', body: 'Hello from email.', source: 'email_bot' },
  ]);
});

test('poller helpers and settings', async () => {
  assert.deepEqual(findTextPart({ type: 'text/plain' }), { part: '1', html: false });
  assert.deepEqual(findTextPart({ childNodes: [{ part: '1', type: 'text/html' }, { part: '2', type: 'text/plain' }] }), { part: '2', html: false });
  assert.equal(findTextPart({ childNodes: [{ part: '1', type: 'image/png' }] }), null);
  assert.equal(htmlToText('a<br>b<style>x{}</style>'), 'a\nb');

  assert.equal(imapSettings({}), null);
  assert.equal(imapSettings({ BOT_IMAP_HOST: 'imap.example.com', BOT_IMAP_USER: 'bot@example.com' }), null);
  const settings = imapSettings({ BOT_IMAP_HOST: 'imap.example.com', BOT_IMAP_USER: 'bot@example.com', BOT_IMAP_PASS: 'pw' });
  assert.deepEqual(settings, {
    host: 'imap.example.com', port: 993, secure: true, user: 'bot@example.com', pass: 'pw', mailbox: 'INBOX', intervalMs: 60000,
  });
  assert.throws(() => imapSettings({ BOT_IMAP_HOST: 'h', BOT_IMAP_USER: 'u', BOT_IMAP_PASS: 'p', BOT_IMAP_POLL_SECONDS: '1' }), /POLL/);

  assert.deepEqual(parseCorsOrigins('http://localhost:5173, https://a.example.org,http://localhost:5173'),
    ['http://localhost:5173', 'https://a.example.org']);
  assert.throws(() => parseCorsOrigins('https://a.example.org/'), /exact/);
  assert.throws(() => parseCorsOrigins('ftp://a.example.org'), /exact/);
  assert.throws(() => parseCorsOrigins(' , '), /at least one/);
});

test('a failed mailbox check is logged without the password and retried later', async () => {
  const lines = [];
  const log = { log: line => lines.push(line), error: line => lines.push(line) };
  let attempts = 0;
  const poller = startImapPoller(null, { host: 'imap.example.com', user: 'bot@example.com', pass: 'secret-pass', intervalMs: 60000 }, {
    log,
    createClient: async () => {
      attempts += 1;
      return { connect: async () => { throw new Error('Connection refused'); }, logout: async () => {} };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  poller.stop();
  assert.equal(attempts, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Connection refused/);
  assert.doesNotMatch(lines[0], /secret-pass/);
});

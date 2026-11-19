import { randomUUID } from 'node:crypto';
import { MAX_BODY, MAX_SUBJECT } from './emailBot.js';
import { bodyFields, fail, queryFields } from './validate.js';

const MESSAGE_FIELDS = `m.id, m.participant_id, m.sender_email, m.subject, m.body, m.source, m.is_read,
  m.doctor_reply, m.replied_at, m.received_at, r.name AS replied_by_name`;

function message(row) {
  return row && { ...row, is_read: row.is_read === 1 };
}

function bodyText(value, field, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail(400, `${field} must be a string`);
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > max) {
    fail(400, `${field} must contain ${allowEmpty ? 'at most' : `1 to`} ${max} characters`);
  }
  return trimmed;
}

// Patients send questions (from the site, or by email through the bot) and
// read the replies; doctors see the questions of their assigned patients only.
export function registerMessageRoutes(app, { db, userAuth, participant, staff, botAddress }) {
  const readMessage = async id => message(await db.get(`SELECT ${MESSAGE_FIELDS} FROM patient_messages m
    LEFT JOIN users r ON r.id = m.replied_by WHERE m.id = ?`, id));

  app.get('/api/bot/info', userAuth, participant, (req, res) => {
    res.json({ address: botAddress, email: req.user.email });
  });

  app.post('/api/messages', userAuth, participant, async (req, res) => {
    bodyFields(req.body, ['body'], ['subject']);
    const subject = req.body.subject === undefined ? '' : bodyText(req.body.subject, 'subject', MAX_SUBJECT, { allowEmpty: true });
    const body = bodyText(req.body.body, 'body', MAX_BODY);
    const id = randomUUID();
    await db.run(`INSERT INTO patient_messages (id, participant_id, sender_email, subject, body, source, received_at)
      VALUES (?, ?, ?, ?, ?, 'portal', ?)`, id, req.user.id, req.user.email, subject || '(no subject)', body, new Date().toISOString());
    res.status(201).json({ message: await readMessage(id) });
  });

  app.get('/api/messages', userAuth, participant, async (req, res) => {
    queryFields(req.query, []);
    const rows = await db.all(`SELECT ${MESSAGE_FIELDS} FROM patient_messages m LEFT JOIN users r ON r.id = m.replied_by
      WHERE m.participant_id = ? ORDER BY m.received_at DESC, m.id DESC LIMIT 100`, req.user.id);
    res.json({ messages: rows.map(message) });
  });

  app.get('/api/doctor/messages', userAuth, staff, async (req, res) => {
    queryFields(req.query, ['unread_only']);
    const unreadOnly = req.query.unread_only;
    if (unreadOnly !== undefined && !['0', '1'].includes(unreadOnly)) fail(400, 'unread_only must be 0 or 1');
    const scope = `FROM patient_messages m JOIN staff_participants sp ON sp.participant_id = m.participant_id AND sp.staff_id = ?`;
    const rows = await db.all(`SELECT ${MESSAGE_FIELDS}, p.name AS participant_name, p.email AS participant_email,
        (SELECT s.id FROM exercise_sessions s WHERE s.participant_id = m.participant_id AND s.status = 'active') AS active_session_id
      ${scope} JOIN users p ON p.id = m.participant_id LEFT JOIN users r ON r.id = m.replied_by
      ${unreadOnly === '1' ? 'WHERE m.is_read = 0' : ''}
      ORDER BY m.received_at DESC, m.id DESC LIMIT 200`, req.user.id);
    const unread = (await db.get(`SELECT COUNT(*) AS n ${scope} WHERE m.is_read = 0`, req.user.id)).n;
    res.json({ messages: rows.map(message), unread_count: unread });
  });

  app.patch('/api/doctor/messages/:id', userAuth, staff, async (req, res) => {
    const row = await db.get(`SELECT m.id FROM patient_messages m JOIN staff_participants sp
      ON sp.participant_id = m.participant_id AND sp.staff_id = ? WHERE m.id = ?`, req.user.id, req.params.id);
    if (!row) fail(404, 'Message not found');
    bodyFields(req.body, [], ['is_read', 'doctor_reply']);
    if (req.body.is_read === undefined && req.body.doctor_reply === undefined) fail(400, 'Send is_read or doctor_reply');
    if (req.body.is_read !== undefined && typeof req.body.is_read !== 'boolean') fail(400, 'is_read must be a boolean');
    const now = new Date().toISOString();
    if (req.body.doctor_reply !== undefined) {
      const reply = bodyText(req.body.doctor_reply, 'doctor_reply', MAX_BODY);
      // Replying also marks the message as read, unless is_read says otherwise.
      await db.run('UPDATE patient_messages SET doctor_reply = ?, replied_by = ?, replied_at = ?, is_read = 1 WHERE id = ?',
        reply, req.user.id, now, row.id);
    }
    if (req.body.is_read !== undefined) {
      await db.run('UPDATE patient_messages SET is_read = ? WHERE id = ?', req.body.is_read ? 1 : 0, row.id);
    }
    res.json({ message: await readMessage(row.id) });
  });
}

// Patient questions and doctor replies.

export const SUBJECT_MAX = 200;
export const BODY_MAX = 4000;

export function sourceLabel(source) {
  return source === 'email_bot' ? 'By email' : 'From the website';
}

// -> { body } for POST /api/messages, or { error }.
export function parseQuestion({ subject = '', body = '' }) {
  const cleanSubject = String(subject).trim();
  const cleanBody = String(body).trim();
  if (!cleanBody) return { error: 'Write your question before sending it.' };
  if (cleanBody.length > BODY_MAX) return { error: `Your question can be at most ${BODY_MAX} characters (now ${cleanBody.length}).` };
  if (cleanSubject.length > SUBJECT_MAX) return { error: `The subject can be at most ${SUBJECT_MAX} characters.` };
  return { body: cleanSubject ? { subject: cleanSubject, body: cleanBody } : { body: cleanBody } };
}

// -> { reply } or { error }.
export function parseReply(text) {
  const reply = String(text ?? '').trim();
  if (!reply) return { error: 'Write a reply before sending it.' };
  if (reply.length > BODY_MAX) return { error: `A reply can be at most ${BODY_MAX} characters (now ${reply.length}).` };
  return { reply };
}

export function unreadText(count) {
  if (!count) return 'No unread messages';
  return `${count} unread message${count === 1 ? '' : 's'}`;
}

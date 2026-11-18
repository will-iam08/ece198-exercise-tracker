export function fail(status, message, extra) {
  throw Object.assign(new Error(message), { status, extra });
}

export function bodyFields(body, required, optional = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'A JSON object is required');
  if (required.some(key => !Object.hasOwn(body, key))) fail(400, `Required fields: ${required.join(', ')}`);
  if (Object.keys(body).some(key => ![...required, ...optional].includes(key))) fail(400, 'Unknown body field');
}

export function text(value, field, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    fail(400, `${field} must be a string of 1-${max} characters`);
  }
  return value.trim();
}

export function integer(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, `${field} must be an integer from ${min} to ${max}`);
  return value;
}

export function queryFields(query, allowed) {
  if (Object.keys(query).some(key => !allowed.includes(key))) fail(400, 'Unknown query parameter');
}

export function queryInteger(value, field, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail(400, `Invalid ${field}`);
  return integer(Number(value), field, min, max);
}

export function email(value) {
  const normalized = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail(400, 'Invalid email address');
  return normalized;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'password must contain 12-128 characters');
  return value;
}

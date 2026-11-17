import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('Password must contain 12 to 128 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 ||
      typeof encoded !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)) return false;
  const [salt, expected] = encoded.split(':');
  const actual = await deriveKey(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(prefix) {
  return prefix + randomBytes(32).toString('base64url');
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at };
}

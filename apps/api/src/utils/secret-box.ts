/**
 * Encrypts small secrets kept in the database (e.g. a workspace's mail server password) with
 * AES-256-GCM. The key comes from SETTINGS_ENCRYPTION_KEY; development falls back to a key
 * derived from COOKIE_SECRET so nothing extra is needed to try the feature locally.
 */
import crypto from 'node:crypto';

const PREFIX = 'v1:';

function key(): Buffer {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('SETTINGS_ENCRYPTION_KEY must be set to store mail server passwords');
  }
  const material = configured || process.env.COOKIE_SECRET || 'change-me-in-production-please-use-32-chars';
  return crypto.createHash('sha256').update(`settings:${material}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error('Unrecognised secret format');
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

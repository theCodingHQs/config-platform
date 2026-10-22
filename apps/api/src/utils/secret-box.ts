/**
 * Encrypts small secrets kept in the database (mail server passwords, email service keys) with
 * AES-256-GCM. The key is never stored in the database, so a copied database alone reveals no
 * secrets. It comes from SETTINGS_ENCRYPTION_KEY when set (hosted servers: keep it in the host's
 * secret settings); otherwise it is created once in a file on the server (SETTINGS_KEY_FILE,
 * default .secrets/settings-encryption.key), so a self-hosted install needs no setup.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'v1:';

let cachedKey: Buffer | null = null;
let cachedFrom = '';

export function encryptionKeySource(): 'env' | 'file' {
  return process.env.SETTINGS_ENCRYPTION_KEY ? 'env' : 'file';
}

export function keyFilePath(): string {
  return path.resolve(process.env.SETTINGS_KEY_FILE || path.join(process.cwd(), '.secrets', 'settings-encryption.key'));
}

function readOrCreateKeyFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    // 'wx': if another process created it first, use theirs
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`[settings] Created the encryption key for stored passwords: ${file} (back it up with your database)`);
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

function key(): Buffer {
  const from = process.env.SETTINGS_ENCRYPTION_KEY ? `env:${process.env.SETTINGS_ENCRYPTION_KEY}` : `file:${keyFilePath()}`;
  if (cachedKey && cachedFrom === from) return cachedKey;
  const material = process.env.SETTINGS_ENCRYPTION_KEY || readOrCreateKeyFile(keyFilePath());
  cachedKey = crypto.createHash('sha256').update(`settings:${material}`).digest();
  cachedFrom = from;
  return cachedKey;
}

export class SecretUnreadableError extends Error {
  constructor() {
    super('A stored password could not be unlocked (the server\'s encryption key changed). Enter the password again and save.');
  }
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new SecretUnreadableError();
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretUnreadableError();
  }
}

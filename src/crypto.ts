import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { config } from './config';

// Envelope encryption with key versioning. Ciphertext is a self-describing packed string:
//   v1:<kid>:<iv-b64>:<tag-b64>:<ciphertext-b64>
// New writes use the active key id; old rows keep decrypting under their original kid, so
// key rotation is just "add a new key + flip ENCRYPTION_ACTIVE_KID" (no migration, no downtime).
const VERSION = 'v1';

export function encrypt(plaintext: string): string {
  const key = config.keyring[config.activeKid];
  if (!key) throw new Error(`active encryption key "${config.activeKid}" is missing`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, config.activeKid, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(packed: string): string {
  const parts = packed.split(':');
  if (parts.length !== 5) throw new Error('malformed ciphertext');
  const [version, kid, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  if (version !== VERSION) throw new Error(`unsupported ciphertext version: ${version}`);
  const key = config.keyring[kid];
  if (!key) throw new Error(`unknown encryption key id: ${kid}`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptJSON(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJSON<T>(packed: string): T {
  return JSON.parse(decrypt(packed)) as T;
}

// --- API keys ---
// Keys are shown once at creation and stored only as a pbkdf2 hash (peppered with API_KEY_SALT).
const API_KEY_BYTES = 24;

export function generateApiKey(prefix: 'sk' | 'pk'): { key: string; keyPrefix: string; keyHash: string } {
  const raw = randomBytes(API_KEY_BYTES).toString('base64url');
  const key = `${prefix}_${raw}`;
  return { key, keyPrefix: key.slice(0, prefix.length + 1 + 8), keyHash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return pbkdf2Sync(key, config.apiKeySalt, 100_000, 32, 'sha256').toString('base64');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

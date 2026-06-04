import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().optional(),
  ENCRYPTION_KEYRING: z.string(),
  ENCRYPTION_ACTIVE_KID: z.string(),
  API_KEY_SALT: z.string().min(16, 'API_KEY_SALT must be at least 16 characters'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),
  PORT: z.coerce.number().default(8787),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().default(600), // per secret key (environment)
  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().default(120), // per IP on public routes
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  console.error('\nTip: run `npm run keygen` to generate the encryption secrets.');
  process.exit(1);
}
const env = parsed.data;

function parseKeyring(raw: string): Record<string, Buffer> {
  let obj: Record<string, string>;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('ENCRYPTION_KEYRING must be valid JSON like {"1":"<base64-32-bytes>"}');
  }
  const ring: Record<string, Buffer> = {};
  for (const [kid, b64] of Object.entries(obj)) {
    const buf = Buffer.from(b64, 'base64');
    if (buf.byteLength !== 32) {
      throw new Error(`ENCRYPTION_KEYRING key "${kid}" must decode to 32 bytes (got ${buf.byteLength})`);
    }
    ring[kid] = buf;
  }
  return ring;
}

const keyring = parseKeyring(env.ENCRYPTION_KEYRING);
if (!keyring[env.ENCRYPTION_ACTIVE_KID]) {
  throw new Error(`ENCRYPTION_ACTIVE_KID "${env.ENCRYPTION_ACTIVE_KID}" is not present in ENCRYPTION_KEYRING`);
}

export const config = {
  databaseUrl: env.DATABASE_URL,
  keyring,
  activeKid: env.ENCRYPTION_ACTIVE_KID,
  apiKeySalt: env.API_KEY_SALT,
  publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
  port: env.PORT,
  rateLimitAuthPerMin: env.RATE_LIMIT_AUTH_PER_MIN,
  rateLimitPublicPerMin: env.RATE_LIMIT_PUBLIC_PER_MIN,
};

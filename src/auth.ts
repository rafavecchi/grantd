import type { MiddlewareHandler } from 'hono';
import { sql } from './db';
import { hashApiKey } from './crypto';

export type Vars = { Variables: { envId: string } };

// Requires a valid secret key (sk_...) and resolves it to an environment id.
// Lookup is by deterministic pbkdf2 hash, so the raw key is never stored.
export const requireSecretKey: MiddlewareHandler<Vars> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(sk_[A-Za-z0-9_-]+)$/);
  if (!match) {
    return c.json({ error: { type: 'unauthorized', message: 'missing or malformed secret key' } }, 401);
  }
  const keyHash = hashApiKey(match[1]!);
  const rows = await sql<{ id: string; environment_id: string }[]>`
    select id, environment_id from api_keys
    where key_hash = ${keyHash} and type = 'secret'
    limit 1`;
  const row = rows[0];
  if (!row) {
    return c.json({ error: { type: 'unauthorized', message: 'invalid secret key' } }, 401);
  }
  c.set('envId', row.environment_id);
  void sql`update api_keys set last_used_at = now() where id = ${row.id}`.catch(() => {});
  await next();
};

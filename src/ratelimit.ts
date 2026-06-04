import type { Context } from 'hono';
import { sql } from './db';

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number; // seconds until the window resets (0 if allowed)
}

// Durable fixed-window limiter backed by Postgres, so limits hold across multiple instances.
// Each request atomically increments a per-(scope:id:window) counter.
export async function rateLimit(scope: string, id: string, limit: number, windowSec = 60): Promise<RateResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowId = Math.floor(nowSec / windowSec);
  const bucket = `${scope}:${id}:${windowId}`;
  const expiresAt = new Date((windowId + 2) * windowSec * 1000);

  const rows = await sql<{ count: number }[]>`
    insert into rate_limit_counters (bucket, count, expires_at)
    values (${bucket}, 1, ${expiresAt})
    on conflict (bucket) do update set count = rate_limit_counters.count + 1
    returning count`;
  const count = rows[0]?.count ?? 1;
  const allowed = count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfter: allowed ? 0 : (windowId + 1) * windowSec - nowSec,
  };
}

// Best-effort cleanup of expired buckets, throttled to once per minute per process.
let lastCleanup = 0;
export function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  void sql`delete from rate_limit_counters where expires_at < now()`.catch(() => {});
}

// Best-effort client IP for public routes (set x-forwarded-for at your proxy/edge).
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

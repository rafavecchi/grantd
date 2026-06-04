import { sql } from './db';
import { decrypt, decryptJSON, encryptJSON } from './crypto';
import { getProvider } from './providers';
import { refreshAccessToken } from './oauth';

const REFRESH_MARGIN_MS = 15 * 60 * 1000; // refresh if the token expires within 15 minutes
const MAX_REFRESH_ATTEMPTS = 5;

export interface StoredCredentials {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
}

interface ConnectionRow {
  id: string;
  environment_id: string;
  integration_id: string;
  provider: string;
  end_user_id: string;
  status: string;
  credentials_enc: string | null;
  expires_at: Date | null;
  granted_scopes: string[];
  refresh_attempts: number;
  refresh_exhausted: boolean;
}

export class ConnectionError extends Error {
  constructor(
    public type: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function isExpired(expiresAt: Date | null, marginMs = REFRESH_MARGIN_MS): boolean {
  if (!expiresAt) return false; // no expiry => never auto-refresh
  return expiresAt.getTime() - Date.now() < marginMs;
}

async function loadConnection(
  q: typeof sql,
  envId: string,
  provider: string,
  endUserId: string,
): Promise<ConnectionRow | null> {
  const rows = await q<ConnectionRow[]>`
    select id, environment_id, integration_id, provider, end_user_id, status,
           credentials_enc, expires_at, granted_scopes, refresh_attempts, refresh_exhausted
    from connections
    where environment_id = ${envId} and provider = ${provider} and end_user_id = ${endUserId}
    limit 1`;
  return rows[0] ?? null;
}

// Returns a valid access token, refreshing under a Postgres advisory lock if needed.
// The post-lock re-read (the "double check") prevents two workers from both refreshing —
// which on providers that rotate the refresh_token would invalidate the connection.
export async function getAccessToken(
  envId: string,
  provider: string,
  endUserId: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<{ accessToken: string; expiresAt: Date | null; connectionId: string }> {
  const providerDef = getProvider(provider);
  const conn = await loadConnection(sql, envId, provider, endUserId);
  if (!conn) throw new ConnectionError('not_found', `no connection for ${provider}/${endUserId}`, 404);
  if (conn.status === 'revoked') throw new ConnectionError('revoked', 'connection was revoked', 409);
  if (!conn.credentials_enc) throw new ConnectionError('not_connected', 'connection is not authorized yet', 409);

  const creds = decryptJSON<StoredCredentials>(conn.credentials_enc);
  const canRefresh = providerDef.refreshable !== false && !!creds.refresh_token;
  const wantRefresh = opts.forceRefresh || isExpired(conn.expires_at);

  if (!wantRefresh || !canRefresh) {
    if (isExpired(conn.expires_at, 0) && !canRefresh) {
      throw new ConnectionError('expired', 'access token expired and cannot be refreshed', 409);
    }
    return { accessToken: creds.access_token, expiresAt: conn.expires_at, connectionId: conn.id };
  }

  const lockKey = `${envId}:${provider}:${endUserId}`;
  return await sql.begin(async (tx) => {
    // Serialize concurrent refreshes for this connection (auto-released at tx end).
    await tx`select pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const fresh = await loadConnection(tx as unknown as typeof sql, envId, provider, endUserId);
    if (!fresh || !fresh.credentials_enc) {
      throw new ConnectionError('not_connected', 'connection is not authorized', 409);
    }
    const freshCreds = decryptJSON<StoredCredentials>(fresh.credentials_enc);

    // Another worker may have refreshed while we waited for the lock.
    if (!opts.forceRefresh && !isExpired(fresh.expires_at)) {
      return { accessToken: freshCreds.access_token, expiresAt: fresh.expires_at, connectionId: fresh.id };
    }
    if (!freshCreds.refresh_token) {
      throw new ConnectionError('expired', 'no refresh token available', 409);
    }

    const integ = await tx<{ oauth_client_id: string; oauth_client_secret_enc: string }[]>`
      select oauth_client_id, oauth_client_secret_enc from integrations where id = ${fresh.integration_id} limit 1`;
    const integration = integ[0];
    if (!integration?.oauth_client_id || !integration.oauth_client_secret_enc) {
      throw new ConnectionError('config_error', 'integration is not fully configured', 500);
    }

    try {
      const tokenSet = await refreshAccessToken({
        provider: providerDef,
        clientId: integration.oauth_client_id,
        clientSecret: decrypt(integration.oauth_client_secret_enc),
        refreshToken: freshCreds.refresh_token,
      });
      const newCreds: StoredCredentials = {
        access_token: tokenSet.accessToken,
        refresh_token: tokenSet.refreshToken ?? freshCreds.refresh_token, // keep old if not rotated
        token_type: 'Bearer',
      };
      await tx`
        update connections set
          credentials_enc = ${encryptJSON(newCreds)},
          expires_at = ${tokenSet.expiresAt ?? null},
          granted_scopes = ${tokenSet.scopes ?? fresh.granted_scopes},
          status = 'active',
          refresh_attempts = 0,
          refresh_exhausted = false,
          last_refresh_error = null,
          updated_at = now()
        where id = ${fresh.id}`;
      return { accessToken: newCreds.access_token, expiresAt: tokenSet.expiresAt ?? null, connectionId: fresh.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = fresh.refresh_attempts + 1;
      const exhausted = attempts >= MAX_REFRESH_ATTEMPTS;
      await tx`
        update connections set
          refresh_attempts = ${attempts},
          refresh_exhausted = ${exhausted},
          last_refresh_error = ${message},
          status = ${exhausted ? 'expired' : fresh.status},
          updated_at = now()
        where id = ${fresh.id}`;
      throw new ConnectionError('refresh_failed', `token refresh failed: ${message}`, 502);
    }
  });
}

// MACU metering: record one active connected user for the current UTC month (idempotent),
// and bump the connection's last_active_at.
export async function recordActivity(envId: string, provider: string, endUserId: string): Promise<void> {
  const yearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)
  await sql`
    insert into monthly_active_users (environment_id, year_month, end_user_id, provider)
    values (${envId}, ${yearMonth}, ${endUserId}, ${provider})
    on conflict (environment_id, year_month, end_user_id) do nothing`;
  await sql`
    update connections set last_active_at = now()
    where environment_id = ${envId} and provider = ${provider} and end_user_id = ${endUserId}`;
}

export async function logRequest(
  envId: string,
  connectionId: string | null,
  provider: string,
  method: string,
  path: string,
  status: number,
  durationMs: number,
): Promise<void> {
  await sql`
    insert into request_logs (environment_id, connection_id, provider, method, path, status, duration_ms)
    values (${envId}, ${connectionId}, ${provider}, ${method}, ${path}, ${status}, ${durationMs})`;
}

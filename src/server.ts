import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { config } from './config';
import { sql } from './db';
import { encrypt, encryptJSON, decrypt } from './crypto';
import { getProvider, listProviders } from './providers';
import {
  buildAuthorizationUrl,
  exchangeCode,
  generateCodeVerifier,
  generateState,
  codeChallengeS256,
} from './oauth';
import { getAccessToken, recordActivity, logRequest, ConnectionError } from './connections';
import { requireSecretKey, type Vars } from './auth';

const app = new Hono<Vars>();

app.get('/health', (c) => c.json({ ok: true }));

app.get('/v1/providers', (c) =>
  c.json({
    data: listProviders().map((p) => ({ slug: p.slug, display_name: p.displayName, auth_mode: p.authMode })),
  }),
);

// --- Integrations: configure a provider's OAuth client for this environment ---
const IntegrationBody = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scopes: z.array(z.string()).default([]),
});

app.put('/v1/integrations/:provider', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const provider = c.req.param('provider');
  getProvider(provider); // validates against the registry (throws -> onError)
  const parsed = IntegrationBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { type: 'invalid_request', message: 'client_id and client_secret are required' } }, 400);
  }
  const { client_id, client_secret, scopes } = parsed.data;
  await sql`
    insert into integrations (environment_id, provider, oauth_client_id, oauth_client_secret_enc, scopes)
    values (${envId}, ${provider}, ${client_id}, ${encrypt(client_secret)}, ${scopes})
    on conflict (environment_id, provider) do update set
      oauth_client_id = excluded.oauth_client_id,
      oauth_client_secret_enc = excluded.oauth_client_secret_enc,
      scopes = excluded.scopes`;
  return c.json({ data: { provider, scopes } });
});

app.get('/v1/integrations', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const rows = await sql<{ provider: string; oauth_client_id: string; scopes: string[] }[]>`
    select provider, oauth_client_id, scopes from integrations
    where environment_id = ${envId} order by provider`;
  return c.json({ data: rows.map((r) => ({ provider: r.provider, client_id: r.oauth_client_id, scopes: r.scopes })) });
});

// --- Connect: create an authorization URL for one end-user + provider ---
const ConnectBody = z.object({
  end_user_id: z.string().min(1),
  provider: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  connection_config: z.record(z.string()).optional(),
  redirect_uri: z.string().url().optional(),
});

app.post('/v1/connect_sessions', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const parsed = ConnectBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { type: 'invalid_request', message: parsed.error.message } }, 400);
  }
  const { end_user_id, provider, scopes, connection_config, redirect_uri } = parsed.data;
  const result = await startProviderConnect({
    envId,
    provider,
    endUserId: end_user_id,
    scopes,
    connectionConfig: connection_config,
    returnUri: redirect_uri ?? null,
  });
  if (!result.ok) return c.json({ error: { type: 'not_configured', message: result.error } }, 400);
  // The DX win vs Nango: the caller already knows end_user_id, so no webhook is needed —
  // after the user finishes, they call /token or /proxy with their own id.
  return c.json({ data: { url: result.url, provider, end_user_id, expires_at: result.expiresAt } });
});

// --- Hosted Connect UI ---
const ConnectUiBody = z.object({
  end_user_id: z.string().min(1),
  providers: z.array(z.string()).optional(),
  redirect_uri: z.string().url().optional(),
});

// Create a short-lived, browser-safe session and return a hosted Connect UI URL.
app.post('/v1/connect_ui_sessions', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const parsed = ConnectUiBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { type: 'invalid_request', message: parsed.error.message } }, 400);
  }
  const { end_user_id, providers, redirect_uri } = parsed.data;
  const token = generateState();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await sql`
    insert into connect_ui_sessions (environment_id, end_user_id, token, allowed_providers, redirect_uri, expires_at)
    values (${envId}, ${end_user_id}, ${token}, ${providers ?? null}, ${redirect_uri ?? null}, ${expiresAt})`;
  return c.json({
    data: { url: `${config.publicBaseUrl}/connect?token=${token}`, token, expires_at: expiresAt.toISOString() },
  });
});

interface UiSessionRow {
  id: string;
  environment_id: string;
  end_user_id: string;
  allowed_providers: string[] | null;
  redirect_uri: string | null;
  expires_at: Date;
}

async function loadUiSession(token: string): Promise<UiSessionRow | null> {
  if (!token) return null;
  const rows = await sql<UiSessionRow[]>`select * from connect_ui_sessions where token = ${token} limit 1`;
  const s = rows[0];
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  return s;
}

// The hosted page: lists the environment's providers with live connection status.
app.get('/connect', async (c) => {
  const token = c.req.query('token') ?? '';
  const session = await loadUiSession(token);
  if (!session) return c.html(page('Link expired', 'This connect link is invalid or has expired.'), 400);

  const integs = await sql<{ provider: string }[]>`
    select provider from integrations where environment_id = ${session.environment_id} order by provider`;
  let providers = integs.map((r) => r.provider);
  if (session.allowed_providers) providers = providers.filter((p) => session.allowed_providers!.includes(p));

  const conns = await sql<{ provider: string; status: string }[]>`
    select provider, status from connections
    where environment_id = ${session.environment_id} and end_user_id = ${session.end_user_id}`;
  const statusByProvider = new Map(conns.map((row) => [row.provider, row.status]));

  return c.html(connectPage(token, providers, statusByProvider, session.redirect_uri));
});

// Starts the OAuth flow for one provider, then returns the user to the Connect UI page.
app.get('/connect/start', async (c) => {
  const token = c.req.query('token') ?? '';
  const provider = c.req.query('provider') ?? '';
  const session = await loadUiSession(token);
  if (!session) return c.html(page('Link expired', 'This connect link is invalid or has expired.'), 400);
  if (session.allowed_providers && !session.allowed_providers.includes(provider)) {
    return c.html(page('Not allowed', `${provider} is not available for this link.`), 400);
  }
  const result = await startProviderConnect({
    envId: session.environment_id,
    provider,
    endUserId: session.end_user_id,
    returnUri: `${config.publicBaseUrl}/connect?token=${token}`,
  });
  if (!result.ok) return c.html(page('Cannot connect', result.error), 400);
  return c.redirect(result.url);
});

// --- OAuth callback (public; the provider redirects here) ---
interface SessionRow {
  id: string;
  environment_id: string;
  integration_id: string;
  provider: string;
  end_user_id: string;
  code_verifier: string | null;
  redirect_uri: string | null;
  scopes: string[];
  connection_config: Record<string, string>;
  expires_at: Date;
}

app.get('/v1/connect/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const oauthError = c.req.query('error');
  if (oauthError) return c.html(page('Authorization failed', oauthError), 400);
  if (!code || !state) return c.html(page('Authorization failed', 'Missing code or state'), 400);

  const sessions = await sql<SessionRow[]>`select * from oauth_sessions where state = ${state} limit 1`;
  const session = sessions[0];
  if (!session) return c.html(page('Authorization failed', 'Invalid or expired session'), 400);
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await sql`delete from oauth_sessions where id = ${session.id}`;
    return c.html(page('Authorization failed', 'Session expired — please try again'), 400);
  }

  const providerDef = getProvider(session.provider);
  const integ = await sql<{ oauth_client_id: string; oauth_client_secret_enc: string }[]>`
    select oauth_client_id, oauth_client_secret_enc from integrations where id = ${session.integration_id} limit 1`;
  const integration = integ[0];
  if (!integration?.oauth_client_id) {
    return c.html(page('Authorization failed', 'Integration is no longer configured'), 400);
  }
  const ourRedirect = `${config.publicBaseUrl}/v1/connect/callback`;

  try {
    const tokenSet = await exchangeCode({
      provider: providerDef,
      clientId: integration.oauth_client_id,
      clientSecret: decrypt(integration.oauth_client_secret_enc),
      code,
      redirectUri: ourRedirect,
      codeVerifier: session.code_verifier ?? undefined,
    });
    const creds = {
      access_token: tokenSet.accessToken,
      refresh_token: tokenSet.refreshToken,
      token_type: 'Bearer',
    };
    await sql`
      insert into connections
        (environment_id, integration_id, provider, end_user_id, status, credentials_enc, granted_scopes, expires_at, connection_config)
      values
        (${session.environment_id}, ${session.integration_id}, ${session.provider}, ${session.end_user_id},
         'active', ${encryptJSON(creds)}, ${tokenSet.scopes ?? session.scopes}, ${tokenSet.expiresAt ?? null},
         ${sql.json(session.connection_config)})
      on conflict (environment_id, provider, end_user_id) do update set
        status = 'active',
        credentials_enc = excluded.credentials_enc,
        granted_scopes = excluded.granted_scopes,
        expires_at = excluded.expires_at,
        refresh_attempts = 0,
        refresh_exhausted = false,
        last_refresh_error = null,
        updated_at = now()`;
    await sql`delete from oauth_sessions where id = ${session.id}`;

    if (session.redirect_uri) return c.redirect(session.redirect_uri);
    return c.html(page('Connected', `Your ${providerDef.displayName} account is connected. You can close this window.`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.html(page('Authorization failed', message), 502);
  }
});

// --- Get a fresh access token (server-side only) ---
app.post('/v1/connections/:provider/:endUserId/token', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const provider = c.req.param('provider');
  const endUserId = c.req.param('endUserId');
  const force = c.req.query('force_refresh') === 'true';
  const { accessToken, expiresAt } = await getAccessToken(envId, provider, endUserId, { forceRefresh: force });
  await recordActivity(envId, provider, endUserId);
  return c.json({ data: { access_token: accessToken, expires_at: expiresAt ? expiresAt.toISOString() : null } });
});

// --- List connections ---
app.get('/v1/connections', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const rows = await sql`
    select provider, end_user_id, status, granted_scopes, expires_at, last_active_at, created_at
    from connections where environment_id = ${envId} order by created_at desc limit 200`;
  return c.json({ data: rows });
});

// --- Revoke a connection ---
app.delete('/v1/connections/:provider/:endUserId', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const provider = c.req.param('provider');
  const endUserId = c.req.param('endUserId');
  const rows = await sql`
    update connections set status = 'revoked', credentials_enc = null, updated_at = now()
    where environment_id = ${envId} and provider = ${provider} and end_user_id = ${endUserId}
    returning id`;
  if (!rows.length) return c.json({ error: { type: 'not_found', message: 'connection not found' } }, 404);
  return c.json({ data: { revoked: true } });
});

// --- Proxy: forward a request to the provider with the user's token injected server-side ---
const HOP_BY_HOP_IN = new Set(['authorization', 'host', 'connection', 'content-length', 'accept-encoding']);
const HOP_BY_HOP_OUT = new Set(['content-encoding', 'transfer-encoding', 'connection', 'content-length']);

app.all('/v1/proxy/:provider/:endUserId/*', requireSecretKey, async (c) => {
  const envId = c.get('envId');
  const provider = c.req.param('provider');
  const endUserId = c.req.param('endUserId');
  const providerDef = getProvider(provider);
  if (!providerDef.proxyBaseUrl) {
    return c.json({ error: { type: 'no_proxy', message: `no proxy base url for ${provider}` } }, 400);
  }

  const prefix = `/v1/proxy/${provider}/${endUserId}`;
  let rest = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
  if (!rest.startsWith('/')) rest = '/' + rest;
  const qIndex = c.req.url.indexOf('?');
  const queryString = qIndex >= 0 ? c.req.url.slice(qIndex) : '';
  const targetUrl = providerDef.proxyBaseUrl.replace(/\/+$/, '') + rest + queryString;

  const { accessToken, connectionId } = await getAccessToken(envId, provider, endUserId);

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_IN.has(key.toLowerCase())) headers.set(key, value);
  });
  for (const [k, v] of Object.entries(providerDef.proxyHeaders ?? {})) headers.set(k, v);
  headers.set('authorization', `Bearer ${accessToken}`);

  const method = c.req.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await c.req.arrayBuffer());

  const started = Date.now();
  const upstream = await fetch(targetUrl, { method, headers, body });
  const duration = Date.now() - started;
  const respBody = await upstream.arrayBuffer();

  void recordActivity(envId, provider, endUserId).catch(() => {});
  void logRequest(envId, connectionId, provider, method, rest, upstream.status, duration).catch(() => {});

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_OUT.has(key.toLowerCase())) outHeaders.set(key, value);
  });
  return new Response(respBody, { status: upstream.status, headers: outHeaders });
});

app.onError((err, c) => {
  if (err instanceof ConnectionError) {
    return c.json({ error: { type: err.type, message: err.message } }, err.status as 400);
  }
  if (err instanceof Error && err.message.startsWith('unknown provider')) {
    return c.json({ error: { type: 'unknown_provider', message: err.message } }, 400);
  }
  console.error(err);
  return c.json({ error: { type: 'internal_error', message: 'internal error' } }, 500);
});

// Shared: create the OAuth session + authorize URL for one provider.
async function startProviderConnect(opts: {
  envId: string;
  provider: string;
  endUserId: string;
  scopes?: string[];
  connectionConfig?: Record<string, string>;
  returnUri: string | null;
}): Promise<{ ok: true; url: string; expiresAt: string } | { ok: false; error: string }> {
  let providerDef;
  try {
    providerDef = getProvider(opts.provider);
  } catch {
    return { ok: false, error: `unknown provider: ${opts.provider}` };
  }
  const integ = await sql<{ id: string; oauth_client_id: string; scopes: string[] }[]>`
    select id, oauth_client_id, scopes from integrations
    where environment_id = ${opts.envId} and provider = ${opts.provider} limit 1`;
  const integration = integ[0];
  if (!integration?.oauth_client_id) {
    return { ok: false, error: `integration '${opts.provider}' is not configured` };
  }
  const state = generateState();
  const usePkce = providerDef.usePKCE !== false && providerDef.authMode === 'OAUTH2';
  const codeVerifier = usePkce ? generateCodeVerifier() : null;
  const effectiveScopes = opts.scopes ?? integration.scopes ?? [];
  const ourRedirect = `${config.publicBaseUrl}/v1/connect/callback`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await sql`
    insert into oauth_sessions
      (environment_id, integration_id, provider, end_user_id, state, code_verifier, redirect_uri, scopes, connection_config, expires_at)
    values
      (${opts.envId}, ${integration.id}, ${opts.provider}, ${opts.endUserId}, ${state}, ${codeVerifier},
       ${opts.returnUri}, ${effectiveScopes}, ${sql.json(opts.connectionConfig ?? {})}, ${expiresAt})`;
  const url = buildAuthorizationUrl({
    provider: providerDef,
    clientId: integration.oauth_client_id,
    redirectUri: ourRedirect,
    state,
    scopes: effectiveScopes,
    codeChallenge: codeVerifier ? codeChallengeS256(codeVerifier) : undefined,
  });
  return { ok: true, url, expiresAt: expiresAt.toISOString() };
}

function connectPage(
  token: string,
  providers: string[],
  status: Map<string, string>,
  doneUrl: string | null,
): string {
  const nameOf = (slug: string): string => {
    try {
      return getProvider(slug).displayName;
    } catch {
      return slug;
    }
  };
  const rows = providers
    .map((p) => {
      const connected = status.get(p) === 'active';
      const action = connected
        ? '<span class="ok">Connected</span>'
        : `<a class="btn" href="/connect/start?token=${encodeURIComponent(token)}&provider=${encodeURIComponent(p)}">Connect</a>`;
      return `<div class="row"><span class="name">${escapeHtml(nameOf(p))}</span>${action}</div>`;
    })
    .join('');
  const empty = providers.length === 0 ? '<p class="muted">No providers are configured yet.</p>' : '';
  const done = doneUrl ? `<a class="done" href="${escapeHtml(doneUrl)}">Done</a>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your accounts</title>
<style>
  body{font:16px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f9;color:#111;margin:0}
  .card{max-width:30rem;margin:6vh auto;background:#fff;border:1px solid #e6e8eb;border-radius:16px;padding:28px 28px 22px;box-shadow:0 10px 40px -20px rgba(0,0,0,.25)}
  h1{font-size:1.3rem;margin:0 0 4px}.sub{color:#667085;margin:0 0 22px;font-size:.95rem}
  .row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-top:1px solid #eef0f2}
  .name{font-weight:550}
  .btn{background:#111;color:#fff;text-decoration:none;padding:8px 16px;border-radius:9px;font-size:.9rem;font-weight:600}
  .ok{color:#0a8a4a;font-weight:600;font-size:.9rem}
  .done{display:block;text-align:center;margin-top:22px;color:#111;font-weight:600;text-decoration:none}
  .muted{color:#667085}.brand{font-size:.8rem;color:#98a2b3;text-align:center;margin-top:18px}
</style></head>
<body><div class="card">
  <h1>Connect your accounts</h1>
  <p class="sub">Authorize the apps you'd like to use, then you can close this window.</p>
  ${rows}${empty}${done}
  <div class="brand">Secured by Grantd</div>
</div></body></html>`;
}

function page(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111}
h1{font-size:1.4rem}.msg{color:#444}</style></head>
<body><h1>${title}</h1><p class="msg">${escapeHtml(message)}</p></body></html>`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Grantd listening on http://localhost:${info.port}`);
});

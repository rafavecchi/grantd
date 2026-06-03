// Grantd TypeScript SDK — let your AI agent act on a user's behalf.
// Zero dependencies; uses the global fetch (Node 18+, Bun, Deno, edge runtimes).

export interface GrantdOptions {
  /** Your secret key (sk_...). */
  apiKey: string;
  /** Broker base URL. Defaults to http://localhost:8787. */
  baseUrl?: string;
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
}

export interface ConnectOptions {
  userId: string;
  provider: string;
  scopes?: string[];
  connectionConfig?: Record<string, string>;
  /** Where to send the user after a successful connection. */
  redirectUri?: string;
}

export interface ConnectResult {
  /** Send the user here to authorize. */
  url: string;
  provider: string;
  userId: string;
  expiresAt: string;
}

export interface TokenResult {
  accessToken: string;
  expiresAt: string | null;
}

export interface Connection {
  provider: string;
  userId: string;
  status: 'pending' | 'active' | 'expired' | 'revoked';
  grantedScopes: string[];
  expiresAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface ProviderInfo {
  slug: string;
  displayName: string;
  authMode: string;
}

export interface ProxyOptions {
  userId: string;
  provider: string;
  /** Provider API path, e.g. "/user" or "/gmail/v1/users/me/messages/send". */
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Object → sent as JSON; string → sent verbatim. */
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
}

export class GrantdError extends Error {
  constructor(
    message: string,
    public status: number,
    public type?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'GrantdError';
  }
}

/** Thrown when the user has no usable connection. Carries a ready-to-use connect URL. */
export class AuthorizationRequiredError extends GrantdError {
  constructor(
    public provider: string,
    public userId: string,
    public connectUrl: string | null,
    type: string,
  ) {
    super(`User "${userId}" needs to authorize ${provider}`, 409, type);
    this.name = 'AuthorizationRequiredError';
  }
}

interface ApiResult {
  status: number;
  json: unknown;
  text: string;
}

const AUTH_ERROR_TYPES = new Set(['not_found', 'not_connected', 'expired', 'revoked']);

export class Grantd {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(opts: GrantdOptions) {
    if (!opts.apiKey) throw new Error('Grantd: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:8787').replace(/\/+$/, '');
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) throw new Error('Grantd: no global fetch available; pass opts.fetch');
    this.fetchImpl = f;
  }

  private async req(
    path: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<ApiResult> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      ...(init.headers ?? {}),
    };
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, json, text };
  }

  private errType(r: ApiResult): string | undefined {
    return (r.json as { error?: { type?: string } } | null)?.error?.type;
  }

  private async throwIfAuthRequired(r: ApiResult, provider: string, userId: string): Promise<void> {
    const type = this.errType(r);
    if ((r.status === 404 || r.status === 409) && type && AUTH_ERROR_TYPES.has(type)) {
      let connectUrl: string | null = null;
      try {
        connectUrl = (await this.connect({ userId, provider })).url;
      } catch {
        /* leave null if a connect link can't be minted (e.g. integration not configured) */
      }
      throw new AuthorizationRequiredError(provider, userId, connectUrl, type);
    }
  }

  /** List the providers the broker can connect. */
  async listProviders(): Promise<ProviderInfo[]> {
    const r = await this.req('/v1/providers');
    const data = ((r.json as { data?: Array<{ slug: string; display_name: string; auth_mode: string }> } | null)
      ?.data ?? []);
    return data.map((p) => ({ slug: p.slug, displayName: p.display_name, authMode: p.auth_mode }));
  }

  /** Configure a provider's OAuth client for this environment. */
  async configureIntegration(
    provider: string,
    opts: { clientId: string; clientSecret: string; scopes?: string[] },
  ): Promise<void> {
    const r = await this.req(`/v1/integrations/${provider}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: opts.clientId, client_secret: opts.clientSecret, scopes: opts.scopes ?? [] }),
    });
    if (r.status >= 400) throw new GrantdError(`configureIntegration failed (${r.status})`, r.status, this.errType(r), r.json);
  }

  /** Create an authorization URL for an end-user to connect a provider. */
  async connect(opts: ConnectOptions): Promise<ConnectResult> {
    const r = await this.req('/v1/connect_sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        end_user_id: opts.userId,
        provider: opts.provider,
        scopes: opts.scopes,
        connection_config: opts.connectionConfig,
        redirect_uri: opts.redirectUri,
      }),
    });
    if (r.status >= 400) throw new GrantdError(`connect failed (${r.status})`, r.status, this.errType(r), r.json);
    const d = (r.json as { data: { url: string; provider: string; end_user_id: string; expires_at: string } }).data;
    return { url: d.url, provider: d.provider, userId: d.end_user_id, expiresAt: d.expires_at };
  }

  /** List all connections in this environment. */
  async listConnections(): Promise<Connection[]> {
    const r = await this.req('/v1/connections');
    const data = ((r.json as { data?: any[] } | null)?.data ?? []) as Array<{
      provider: string;
      end_user_id: string;
      status: Connection['status'];
      granted_scopes: string[];
      expires_at: string | null;
      last_active_at: string | null;
      created_at: string;
    }>;
    return data.map((c) => ({
      provider: c.provider,
      userId: c.end_user_id,
      status: c.status,
      grantedScopes: c.granted_scopes,
      expiresAt: c.expires_at,
      lastActiveAt: c.last_active_at,
      createdAt: c.created_at,
    }));
  }

  /** Get a fresh access token for a user+provider (server-side use only). */
  async getToken(opts: { userId: string; provider: string; forceRefresh?: boolean }): Promise<TokenResult> {
    const qs = opts.forceRefresh ? '?force_refresh=true' : '';
    const r = await this.req(`/v1/connections/${opts.provider}/${opts.userId}/token${qs}`, { method: 'POST' });
    await this.throwIfAuthRequired(r, opts.provider, opts.userId);
    if (r.status >= 400) throw new GrantdError(`getToken failed (${r.status})`, r.status, this.errType(r), r.json);
    const d = (r.json as { data: { access_token: string; expires_at: string | null } }).data;
    return { accessToken: d.access_token, expiresAt: d.expires_at };
  }

  /** Revoke a user's connection. */
  async revoke(opts: { userId: string; provider: string }): Promise<void> {
    const r = await this.req(`/v1/connections/${opts.provider}/${opts.userId}`, { method: 'DELETE' });
    if (r.status >= 400 && r.status !== 404) {
      throw new GrantdError(`revoke failed (${r.status})`, r.status, this.errType(r), r.json);
    }
  }

  /**
   * Make an authorized API call to a provider on behalf of a user. The user's token is
   * injected server-side and never returned. Throws AuthorizationRequiredError (with a
   * connectUrl) if the user isn't connected.
   */
  async proxy<T = any>(opts: ProxyOptions): Promise<T> {
    const method = opts.method ?? 'GET';
    const p = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
    const qs = opts.query
      ? '?' +
        new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)] as [string, string])).toString()
      : '';
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: string | undefined;
    if (opts.body !== undefined && method !== 'GET') {
      if (typeof opts.body === 'string') {
        body = opts.body;
      } else {
        body = JSON.stringify(opts.body);
        headers['content-type'] = headers['content-type'] ?? 'application/json';
      }
    }
    const r = await this.req(`/v1/proxy/${opts.provider}/${opts.userId}${p}${qs}`, { method, headers, body });
    await this.throwIfAuthRequired(r, opts.provider, opts.userId);
    if (r.status >= 400) {
      throw new GrantdError(`provider request failed (${r.status})`, r.status, this.errType(r), r.json ?? r.text);
    }
    return (r.json ?? r.text) as T;
  }
}

export default Grantd;

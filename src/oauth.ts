import { createHash, randomBytes } from 'node:crypto';
import type { ProviderDef } from './providers';

// Generic OAuth 2.0 authorization-code client, driven entirely by ProviderDef data.
// Handles PKCE, scope formatting, basic-vs-body client auth, accept headers, and
// non-standard token-response key mapping.

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date; // derived from expires_in
  scopes?: string[];
  raw: Record<string, unknown>;
}

export function generateState(): string {
  return randomBytes(32).toString('base64url');
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// Substitutes `${connectionConfig.x}` placeholders (e.g. a per-connection subdomain) in a
// provider's proxy base URL using the values captured at connect time.
export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{connectionConfig\.([A-Za-z0-9_]+)\}/g, (_match, key: string) => vars[key] ?? '');
}

function joinScopes(provider: ProviderDef, scopes: string[]): string {
  const all = [...(provider.defaultScopes ?? []), ...scopes];
  return Array.from(new Set(all)).join(provider.scopeSeparator ?? ' ');
}

export interface AuthUrlParams {
  provider: ProviderDef;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  codeChallenge?: string;
}

export function buildAuthorizationUrl(p: AuthUrlParams): string {
  if (!p.provider.authorizationUrl) throw new Error(`${p.provider.slug} has no authorizationUrl`);
  const url = new URL(p.provider.authorizationUrl);
  const q = url.searchParams;
  q.set('response_type', 'code');
  q.set('client_id', p.clientId);
  q.set('redirect_uri', p.redirectUri);
  q.set('state', p.state);
  const scopeStr = joinScopes(p.provider, p.scopes);
  if (scopeStr) q.set('scope', scopeStr);
  if (p.codeChallenge) {
    q.set('code_challenge', p.codeChallenge);
    q.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(p.provider.authorizationParams ?? {})) q.set(k, v);
  return url.toString();
}

interface TokenRequestBase {
  provider: ProviderDef;
  clientId: string;
  clientSecret: string;
}

export async function exchangeCode(
  args: TokenRequestBase & { code: string; redirectUri: string; codeVerifier?: string },
): Promise<TokenSet> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
  };
  if (args.codeVerifier) body.code_verifier = args.codeVerifier;
  return tokenRequest(args.provider, args.clientId, args.clientSecret, body, args.provider.tokenUrl);
}

export async function refreshAccessToken(
  args: TokenRequestBase & { refreshToken: string },
): Promise<TokenSet> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
  };
  const url = args.provider.refreshUrl ?? args.provider.tokenUrl;
  return tokenRequest(args.provider, args.clientId, args.clientSecret, body, url);
}

async function tokenRequest(
  provider: ProviderDef,
  clientId: string,
  clientSecret: string,
  body: Record<string, string>,
  tokenUrl?: string,
): Promise<TokenSet> {
  if (!tokenUrl) throw new Error(`${provider.slug} has no tokenUrl`);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: provider.tokenAcceptHeader ?? 'application/json',
  };
  const form = new URLSearchParams(body);
  if (provider.tokenAuthMethod === 'basic') {
    headers.authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  } else {
    form.set('client_id', clientId);
    form.set('client_secret', clientSecret);
  }

  const res = await fetch(tokenUrl, { method: 'POST', headers, body: form.toString() });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`token endpoint returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || json.error) {
    throw new Error(`token request failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return parseTokenResponse(provider, json);
}

// Reads a possibly-nested key like "authed_user.access_token" out of a token response.
function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    return acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined;
  }, obj);
}

export function parseTokenResponse(provider: ProviderDef, json: Record<string, unknown>): TokenSet {
  const map = provider.tokenResponseMap ?? {};
  // Try the provider's mapped (possibly nested) key, then fall back to the standard top-level key.
  // This handles providers like Slack that nest the user token under `authed_user.access_token`.
  const pick = (mapped: string | undefined, fallback: string): unknown =>
    (mapped ? getPath(json, mapped) : undefined) ?? getPath(json, fallback);

  const accessToken = String(pick(map.accessToken, 'access_token') ?? '');
  if (!accessToken) throw new Error(`no access_token in token response for ${provider.slug}`);

  const refreshTokenRaw = pick(map.refreshToken, 'refresh_token');
  const expiresInRaw = pick(map.expiresIn, 'expires_in');
  const expiresIn =
    typeof expiresInRaw === 'number'
      ? expiresInRaw
      : typeof expiresInRaw === 'string'
        ? parseInt(expiresInRaw, 10)
        : undefined;
  const scopeRaw = pick(map.scope, 'scope');

  return {
    accessToken,
    refreshToken: typeof refreshTokenRaw === 'string' ? refreshTokenRaw : undefined,
    expiresAt: expiresIn && !Number.isNaN(expiresIn) ? new Date(Date.now() + expiresIn * 1000) : undefined,
    scopes: typeof scopeRaw === 'string' ? scopeRaw.split(/[ ,]/).filter(Boolean) : undefined,
    raw: json,
  };
}

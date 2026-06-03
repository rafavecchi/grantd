// Declarative provider registry. A provider is DATA, not code — this is the highest-leverage
// pattern from Nango (one engine, many providers). The generic OAuth2 client in oauth.ts
// consumes these definitions. MVP supports OAUTH2 + API_KEY.

export type AuthMode = 'OAUTH2' | 'API_KEY';

export interface ProviderDef {
  slug: string;
  displayName: string;
  authMode: AuthMode;

  // OAuth2 endpoints
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string; // defaults to tokenUrl

  // Quirk knobs (these ~7 fields cover ~95% of providers)
  scopeSeparator?: string; // default ' '
  defaultScopes?: string[];
  authorizationParams?: Record<string, string>;
  usePKCE?: boolean; // default true for OAUTH2
  tokenAuthMethod?: 'basic' | 'body'; // how client creds are sent on the token request; default 'body'
  tokenAcceptHeader?: string; // e.g. 'application/json' for GitHub
  tokenResponseMap?: { accessToken?: string; refreshToken?: string; expiresIn?: string };
  refreshable?: boolean; // default true for OAUTH2

  // Proxy
  proxyBaseUrl?: string; // may contain ${connectionConfig.x} templating
  proxyHeaders?: Record<string, string>;
}

export const PROVIDERS: Record<string, ProviderDef> = {
  google: {
    slug: 'google',
    displayName: 'Google',
    authMode: 'OAUTH2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopeSeparator: ' ',
    authorizationParams: { access_type: 'offline', prompt: 'consent' }, // needed to get a refresh_token
    usePKCE: true,
    tokenAuthMethod: 'body',
    refreshable: true,
    proxyBaseUrl: 'https://www.googleapis.com',
  },

  github: {
    slug: 'github',
    displayName: 'GitHub',
    authMode: 'OAUTH2',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopeSeparator: ' ',
    usePKCE: false, // classic OAuth apps don't support PKCE
    tokenAuthMethod: 'body',
    tokenAcceptHeader: 'application/json', // else GitHub returns a form-encoded body
    refreshable: false, // classic OAuth tokens don't expire
    proxyBaseUrl: 'https://api.github.com',
  },

  slack: {
    slug: 'slack',
    displayName: 'Slack',
    authMode: 'OAUTH2',
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopeSeparator: ',',
    usePKCE: false,
    tokenAuthMethod: 'body',
    refreshable: false, // unless token rotation is enabled on the Slack app
    proxyBaseUrl: 'https://slack.com/api',
    // NOTE: Slack returns a nested response (bot token at `access_token`, user token at
    // `authed_user.access_token`). The generic parser handles the bot token; user-token
    // extraction is a TODO when we add per-token-type selection.
  },

  notion: {
    slug: 'notion',
    displayName: 'Notion',
    authMode: 'OAUTH2',
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    authorizationParams: { owner: 'user' },
    usePKCE: false,
    tokenAuthMethod: 'basic', // Notion requires HTTP Basic with client id/secret on the token request
    refreshable: false,
    proxyBaseUrl: 'https://api.notion.com',
  },
};

export function getProvider(slug: string): ProviderDef {
  const p = PROVIDERS[slug];
  if (!p) throw new Error(`unknown provider: ${slug}`);
  return p;
}

export function listProviders(): ProviderDef[] {
  return Object.values(PROVIDERS);
}

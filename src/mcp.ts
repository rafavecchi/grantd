import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Grantd MCP server — exposes the broker to an AI agent (Claude/Cursor) as tools.
// It is a thin client of the Grantd HTTP API, configured with a secret key.
// NOTE: stdio is the transport — only log to stderr (console.error), never stdout.

const BASE = (process.env.GRANTD_BASE_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const API_KEY = process.env.GRANTD_API_KEY ?? '';
const DEFAULT_END_USER = process.env.GRANTD_END_USER ?? '';

if (!API_KEY) {
  console.error('GRANTD_API_KEY is required (an sk_... secret key).');
  process.exit(1);
}

interface ApiResult {
  status: number;
  json: unknown;
  text: string;
}

async function api(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${API_KEY}`,
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

function resolveUser(provided?: string): string {
  const u = provided ?? DEFAULT_END_USER;
  if (!u) throw new Error('end_user_id is required (no GRANTD_END_USER default is set).');
  return u;
}

async function connectLink(provider: string, endUser: string): Promise<string | null> {
  const r = await api('/v1/connect_sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ end_user_id: endUser, provider }),
  });
  const data = (r.json as { data?: { url?: string } } | null)?.data;
  return data?.url ?? null;
}

function text(value: unknown, isError = false) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return { content: [{ type: 'text' as const, text: body }], isError };
}

const server = new McpServer({ name: 'grantd', version: '0.0.1' });

server.tool(
  'list_providers',
  'List the third-party providers Grantd can connect on a user\'s behalf (e.g. google, github).',
  {},
  async () => {
    const r = await api('/v1/providers');
    const data = (r.json as { data?: unknown } | null)?.data ?? r.text;
    return text(data);
  },
);

server.tool(
  'check_connection',
  "Check whether an end-user has an active connection to a provider. If not, returns a connect_url to share with them.",
  {
    provider: z.string().describe('provider slug, e.g. "google" or "github"'),
    end_user_id: z.string().optional().describe('the end-user id; defaults to GRANTD_END_USER'),
  },
  async ({ provider, end_user_id }) => {
    const endUser = resolveUser(end_user_id);
    const r = await api('/v1/connections');
    const conns = ((r.json as { data?: any[] } | null)?.data ?? []) as Array<{
      provider: string;
      end_user_id: string;
      status: string;
      granted_scopes: string[];
      expires_at: string | null;
    }>;
    const match = conns.find((c) => c.provider === provider && c.end_user_id === endUser);
    if (!match || match.status !== 'active') {
      const url = await connectLink(provider, endUser);
      return text({
        connected: false,
        authorization_required: true,
        connect_url: url,
        message: `User "${endUser}" is not connected to ${provider}. Share connect_url with them to authorize.`,
      });
    }
    return text({
      connected: true,
      provider,
      end_user_id: endUser,
      granted_scopes: match.granted_scopes,
      expires_at: match.expires_at,
    });
  },
);

server.tool(
  'create_connect_link',
  'Create an authorization URL an end-user visits to connect a provider account.',
  {
    provider: z.string().describe('provider slug, e.g. "google" or "github"'),
    end_user_id: z.string().optional().describe('the end-user id; defaults to GRANTD_END_USER'),
  },
  async ({ provider, end_user_id }) => {
    const endUser = resolveUser(end_user_id);
    const url = await connectLink(provider, endUser);
    if (!url) {
      return text(`Could not create a connect link for ${provider}. Is the integration configured?`, true);
    }
    return text({ connect_url: url, message: `Send the user to connect_url to authorize ${provider}.` });
  },
);

server.tool(
  'call_provider',
  "Make an authorized API call to a provider on behalf of an end-user. The user's OAuth token is injected server-side and never exposed to you. If the user isn't connected, returns an authorization_required result with a connect link — share it with the user, then retry.",
  {
    provider: z.string().describe('provider slug, e.g. "google" or "github"'),
    path: z
      .string()
      .describe('provider API path, e.g. "/user" (github) or "/gmail/v1/users/me/messages/send" (google)'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('HTTP method (default GET)'),
    body: z.string().optional().describe('request body as a JSON string (for POST/PUT/PATCH)'),
    end_user_id: z.string().optional().describe('the end-user id; defaults to GRANTD_END_USER'),
  },
  async ({ provider, path, method, body, end_user_id }) => {
    const endUser = resolveUser(end_user_id);
    const m = method ?? 'GET';
    const p = path.startsWith('/') ? path : `/${path}`;
    const init: RequestInit = { method: m };
    if (body && m !== 'GET') {
      init.body = body;
      init.headers = { 'content-type': 'application/json' };
    }
    const r = await api(`/v1/proxy/${provider}/${endUser}${p}`, init);

    // Auth-gating: turn "not connected" into an actionable authorization_required result.
    const errType = (r.json as { error?: { type?: string } } | null)?.error?.type;
    if ([404, 409].includes(r.status) && ['not_found', 'not_connected', 'expired', 'revoked'].includes(errType ?? '')) {
      const url = await connectLink(provider, endUser);
      return text({
        authorization_required: true,
        provider,
        end_user_id: endUser,
        reason: errType,
        connect_url: url,
        message: `User "${endUser}" needs to authorize ${provider}. Share connect_url with them, then retry this call.`,
      });
    }
    return text(r.json ?? r.text, r.status >= 400);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Grantd MCP server connected (base=${BASE}, default_user=${DEFAULT_END_USER || '(none)'})`);

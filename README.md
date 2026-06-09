# Grantd

OAuth-for-agents: a dead-simple, MCP-native OAuth token broker that lets AI agents securely
act on a user's behalf across third-party APIs (Gmail, Slack, GitHub, Notion…). Tokens are
vaulted server-side and never touch the LLM.

Stack: TypeScript · Hono · Postgres · generic OAuth2 driven by a declarative provider registry ·
envelope encryption (AES-256-GCM, key-versioned) · Postgres advisory locks for refresh concurrency
(no Redis). Security model and how to report issues: [SECURITY.md](SECURITY.md).

## Security at a glance

Grantd vaults users' OAuth tokens, so security is the product, not a feature. The fundamentals:

- **Tokens encrypted at rest** — AES-256-GCM envelope encryption, fresh IV per record, key-versioned,
  and **fail-closed** (a missing key refuses to write; it never silently stores plaintext).
- **Tokens never reach the LLM or the caller.** The proxy injects the access token at the network
  boundary and returns only the provider's response — the raw token is never serialized back.
- **API keys hashed at rest** (pbkdf2-sha256, peppered); the raw `sk_` key is shown once.
- **No SQL injection** — every query is a parameterized `postgres.js` tagged template.
- **Tenant isolation** on every query by environment id; **Row-Level Security** enabled on all tables
  so a Postgres REST layer (e.g. Supabase/PostgREST) can't read the vault.
- **256-bit random** OAuth `state` + session tokens; **PKCE (S256)** where the provider supports it.
- **Durable, Postgres-backed rate limiting** — per secret key on auth routes, per IP on public routes.

This is open-source infrastructure **you run yourself**. Self-hosting responsibilities (key custody,
TLS, an edge/WAF for volumetric DoS) and known limitations are documented honestly in
[SECURITY.md](SECURITY.md). If you intend to run a hosted, multi-tenant deployment that holds other
people's tokens, work through [HOSTED-CHECKLIST.md](HOSTED-CHECKLIST.md) first.

## Providers

| Provider | Status |
|---|---|
| Google (Gmail, Calendar, …) | ✅ Verified end-to-end, including token refresh |
| GitHub | ✅ Verified end-to-end |
| Slack | 🧪 Experimental — config present, not yet verified against live OAuth |
| Notion | 🧪 Experimental — config present, not yet verified against live OAuth |

Adding a provider is data, not code (see `src/providers.ts`). Help verifying Slack/Notion is welcome.

## Quick start (dev)

```bash
npm install
npm run keygen            # prints an ENCRYPTION_KEYRING + API_KEY_SALT
cp .env.example .env      # then paste keygen output + your DATABASE_URL
npm run migrate           # apply SQL migrations
npm run dev               # start the broker on :8787
```

## MCP server

Exposes the broker to an AI agent (Claude Code / Cursor / Claude Desktop) as tools:
`list_providers`, `check_connection`, `create_connect_link`, and `call_provider`. The
auth-gating wedge: if the agent calls `call_provider` for a user who isn't connected, it
returns an `authorization_required` result with a connect link instead of failing.

The MCP server is published to npm as [`grantd-mcp`](https://www.npmjs.com/package/grantd-mcp), so
you don't need to clone this repo to use it — just point an MCP client at it (you do need a running
broker and a secret key). For local development: `npm run mcp` (needs the broker running); smoke
test: `npm run mcp:test`.

Add to Claude Code:

```bash
claude mcp add grantd \
  --env GRANTD_API_KEY=sk_... \
  --env GRANTD_BASE_URL=https://your-broker.example.com \
  --env GRANTD_END_USER=user-123 \
  -- npx -y grantd-mcp
```

Or in a Cursor / Claude Desktop `mcpServers` config:

```json
{
  "mcpServers": {
    "grantd": {
      "command": "npx",
      "args": ["-y", "grantd-mcp"],
      "env": {
        "GRANTD_API_KEY": "sk_...",
        "GRANTD_BASE_URL": "https://your-broker.example.com",
        "GRANTD_END_USER": "user-123"
      }
    }
  }
}
```

## Layout

```
migrations/   SQL schema (Supabase/Postgres compatible)
scripts/      keygen + migrate helpers
src/
  config.ts   env loading + validation + keyring parse
  crypto.ts   envelope encryption + API-key hashing
  db.ts       postgres.js client
  providers.ts declarative provider registry (Google, GitHub, Slack, Notion)
  oauth.ts    generic OAuth2 client (authorize / exchange / refresh) driven by the registry
  server.ts   Hono app + routes (WIP)
```

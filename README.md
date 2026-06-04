# Grantd

OAuth-for-agents: a dead-simple, MCP-native OAuth token broker that lets AI agents securely
act on a user's behalf across third-party APIs (Gmail, Slack, GitHub, Notion…). Tokens are
vaulted server-side and never touch the LLM.

Stack: TypeScript · Hono · Postgres · generic OAuth2 driven by a declarative provider registry ·
envelope encryption (AES-256-GCM, key-versioned) · Postgres advisory locks for refresh concurrency
(no Redis). Security model and how to report issues: [SECURITY.md](SECURITY.md).

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

Run standalone (needs the broker running): `npm run mcp`. Smoke test: `npm run mcp:test`.

Add to Claude Code:

```bash
claude mcp add grantd \
  --env GRANTD_API_KEY=sk_... \
  --env GRANTD_BASE_URL=http://localhost:8787 \
  --env GRANTD_END_USER=rafa \
  -- npx tsx C:/Users/Rafav/grantd/src/mcp.ts
```

Or in a Cursor / Claude Desktop `mcpServers` config:

```json
{
  "mcpServers": {
    "grantd": {
      "command": "npx",
      "args": ["tsx", "C:\\Users\\Rafav\\grantd\\src\\mcp.ts"],
      "env": {
        "GRANTD_API_KEY": "sk_...",
        "GRANTD_BASE_URL": "http://localhost:8787",
        "GRANTD_END_USER": "rafa"
      }
    }
  }
}
```

(Windows fallback if `npx` spawn misbehaves: use `"command": "node"`, `"args": ["C:\\Users\\Rafav\\grantd\\node_modules\\tsx\\dist\\cli.mjs", "C:\\Users\\Rafav\\grantd\\src\\mcp.ts"]`.)

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

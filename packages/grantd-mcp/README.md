# grantd-mcp

The **Grantd** MCP server — let your AI agent act on a user's behalf across third-party APIs
(Gmail, GitHub, and more) without ever handling their OAuth tokens.

It's a thin [MCP](https://modelcontextprotocol.io) client of a [Grantd](https://github.com/rafavecchi/grantd)
broker: you connect a user once, and the agent calls provider APIs *as that user*. Tokens are vaulted
server-side by the broker and never reach the model. When a user isn't connected, the tools return a
ready-to-use connect link instead of failing.

## Tools

- `list_providers` — providers Grantd can connect (e.g. `google`, `github`).
- `check_connection` — is an end-user connected to a provider? If not, returns a connect link.
- `create_connect_link` — an authorization URL the end-user visits to connect an account.
- `call_provider` — make an authorized API call to a provider on behalf of an end-user.

## Usage

You need a running Grantd broker and a secret key (`sk_…`). See the
[main repo](https://github.com/rafavecchi/grantd) to self-host one in a couple of minutes.

Add it to an MCP client (Claude Code, Cursor, Claude Desktop):

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

Or with the Claude Code CLI:

```bash
claude mcp add grantd \
  --env GRANTD_API_KEY=sk_... \
  --env GRANTD_BASE_URL=https://your-broker.example.com \
  --env GRANTD_END_USER=user-123 \
  -- npx -y grantd-mcp
```

### Environment

| Variable | Required | Description |
|---|---|---|
| `GRANTD_API_KEY` | yes | A Grantd secret key (`sk_…`). Treat it like a password. |
| `GRANTD_BASE_URL` | no | Broker base URL (default `http://localhost:8787`). |
| `GRANTD_END_USER` | no | Default end-user id, so tools don't need it passed each call. |

MIT licensed. Part of [Grantd](https://github.com/rafavecchi/grantd).

# Show HN draft

**Title:** Show HN: Grantd – Open-source OAuth-for-agents (let your AI agent act as your users)

**URL:** https://github.com/rafavecchi/grantd

**Body:**

Hi HN — I built Grantd, an open-source OAuth token broker for AI agents.

The problem: the moment your agent needs to *do something in a user's account* — send their
email, open a PR in their repo, post to their Slack — you're suddenly on the hook for OAuth
flows, encrypted token storage, refresh races, and webhook plumbing. None of it is your product,
all of it is required, and getting the refresh-token locking wrong silently logs your users out.

Grantd sits between your agent and your users' accounts:

- You connect a user once (you get a link; they authorize).
- Your agent calls any provider API as that user: `proxy({ userId, provider: 'github', path: '/user' })`.
- The broker injects the user's token **server-side** and returns the response. The raw token
  never touches your code or the LLM.

Two things I cared about:

1. **No webhooks.** You call by your own user id, so there's no async callback dance.
2. **The "not connected" case is a feature.** If the user hasn't authorized, `proxy()` throws
   an `AuthorizationRequiredError` carrying a ready-to-use connect link — not a 401.

It's MCP-native too: point Claude Code or Cursor at the MCP server and your agent gets tools that
auto-gate on auth. The frameworks (LangGraph, CrewAI, OpenAI Agents SDK) deliberately punt OAuth to
a partner — this is that partner, open source.

Stack: TypeScript + Postgres broker, envelope-encrypted token vault (AES-256-GCM, key-versioned),
refresh under a Postgres advisory lock with a post-lock re-check (the thing that prevents the
double-refresh bug). TypeScript and Python SDKs. Providers today: Google, GitHub, Slack, Notion,
plus a declarative registry so adding more is data, not code.

It's early and I'd genuinely love feedback — on the security model, the API ergonomics, and which
providers/frameworks you'd want next.

Repo: https://github.com/rafavecchi/grantd

---

_Posting notes: post Tue–Thu ~8–10am ET. Keep replying to comments for the first few hours —
engagement in the first hour is what surfaces it. Lead with the problem, not the product._

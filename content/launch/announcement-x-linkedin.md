# X / LinkedIn announcement drafts

## X (Twitter) — thread

**1/**
Your AI agent can think. Can it act *as your user*?

Sending their email, opening their PR, posting to their Slack means OAuth, token vaults, refresh
races, webhooks. None of it is your product.

So I open-sourced Grantd — OAuth-for-agents. 🧵

**2/**
Connect a user once. Then your agent calls any provider API as them:

`proxy({ userId, provider: 'github', path: '/user' })`

The token is injected server-side and never touches your code or the LLM.

**3/**
Two things I cared about:

→ No webhooks. You call by your own user id.
→ If the user isn't connected, you get an AuthorizationRequiredError with a ready connect link — not a 401.

**4/**
It's MCP-native: point Claude Code or Cursor at the MCP server and your agent gets tools that
auto-gate on auth. TypeScript + Python SDKs. Google, GitHub, Slack, Notion to start.

MIT, self-hostable. Would love your feedback 👇
github.com/rafavecchi/grantd

---

## LinkedIn — single post

I kept rebuilding the same plumbing in every AI agent: OAuth flows, encrypted token storage, refresh
logic, webhooks — all just to let the agent act on a user's behalf in Gmail, GitHub, Slack.

So I open-sourced **Grantd**: an OAuth token broker for AI agents. You connect a user once; your
agent then calls any provider API *as that user*, with the token injected server-side and never
exposed to your code or the model. No webhooks, refresh handled, and if the user isn't connected
you get a ready-to-use authorization link instead of an error.

It's MCP-native (works inside Claude Code / Cursor) with TypeScript and Python SDKs, MIT-licensed
and self-hostable.

It's early and I'm looking for feedback from people building agents — what would you connect first?

🔗 github.com/rafavecchi/grantd

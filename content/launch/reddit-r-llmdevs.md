# r/LLMDevs (and r/AI_Agents) draft

**Title:** I got tired of wiring OAuth into every agent, so I built an open-source "OAuth-for-agents" broker

**Body:**

Every time I built an agent that had to act *as a user* in some service — send their Gmail, open a
GitHub PR, read their calendar — I ended up rebuilding the same plumbing: OAuth flow per provider,
encrypted token storage, refresh logic, webhook to learn when the connection completed. It's not
the interesting part, but it's a lot of surface area to get wrong (and if you mess up refresh-token
locking, you silently log users out).

So I built **Grantd** (open source, MIT): a token broker that vaults your users' OAuth tokens and
injects them server-side, so your agent calls provider APIs as the user without ever touching a
token.

```python
from grantd import Grantd, AuthorizationRequiredError
g = Grantd(api_key="sk_...")

try:
    profile = g.proxy(user_id=user.id, provider="github", path="/user")
except AuthorizationRequiredError as e:
    redirect(e.connect_url)   # not connected yet — send them here, then retry
```

Design decisions I'd love opinions on:

- **No webhooks.** You call by your own `user_id`, so there's no async callback to learn an opaque
  connection id. After the user authorizes, you just call.
- **Auth-gating as a typed error.** `proxy()`/`get_token()` raise `AuthorizationRequiredError` with
  a connect link when the user isn't connected. Makes agents feel reliable: an action either happens
  or returns "ask the user to connect here."
- **Token never enters the LLM.** Calls go through a proxy that injects the token at the network
  boundary.
- **MCP-native.** There's an MCP server so Claude/Cursor agents get auth-gated tools directly.

Sync + async Python and a TypeScript SDK. Providers: Google, GitHub, Slack, Notion so far, with a
declarative registry for adding more.

Repo + docs: https://github.com/rafavecchi/grantd

Honest status: it's early. I'd really value feedback on the security model and which
providers/frameworks you'd reach for first. Happy to answer anything in the comments.

---

_Posting notes: r/LLMDevs and r/AI_Agents are the best fits; r/LangChain if you lead with the
LangGraph example. Reddit hates anything that smells like an ad — keep it first-person and
problem-first, and actually reply to comments._

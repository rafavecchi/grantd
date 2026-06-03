---
title: How to let your AI agent act on a user's behalf (OAuth for agents)
description: A practical guide to giving AI agents authorized access to your users' third-party accounts — Gmail, Slack, GitHub — without leaking tokens, breaking on refresh, or building webhook plumbing.
date: 2026-06-03
---

# How to let your AI agent act on a user's behalf

You've built an AI agent that's genuinely useful. Now a user asks it to *do something in their
accounts*: "reply to that email," "open a PR," "post the summary to our Slack." The instant your
agent needs to act **as a specific user** in a third-party service, you hit a wall that has nothing
to do with AI and everything to do with OAuth.

This guide covers how to do it correctly: the problem, the naive approaches and why they fail, the
right architecture (a token broker), and a working implementation.

## The problem in one sentence

Your agent needs a valid OAuth access token for *this user* on *this provider*, at the moment of the
tool call — and getting one safely is a surprising amount of infrastructure.

To do it yourself, you need to:

1. Run the OAuth 2.0 authorization-code flow for each provider (consent screen, callback, code exchange).
2. Store the resulting access **and** refresh tokens encrypted at rest.
3. Refresh access tokens before they expire — without two concurrent requests both refreshing and
   invalidating each other (a real bug that silently logs users out on providers that rotate refresh tokens).
4. Keep the raw token **out of your LLM's context**, or you've handed a secret to a model and its logs.
5. Map every provider's quirks: different scopes formats, token-response shapes, PKCE support, base URLs.

None of that is your product. All of it is required.

## Why the naive approaches fail

**"I'll just store the token in my database."** Storing an access token isn't enough — it expires in
an hour. You need the refresh token too, encrypted, with a refresh routine and a lock so concurrent
agent calls don't stampede the token endpoint. Get the locking wrong and connections die.

**"I'll pass the token to the agent as a tool argument."** Now the token is in the model's context
window, its traces, and possibly your observability logs. A leaked Gmail token is a leaked mailbox.
Tokens should never enter the LLM.

**"I'll let the framework handle it."** Agent frameworks (LangGraph, CrewAI, the OpenAI Agents SDK)
deliberately *don't* ship OAuth. Their own docs tell you to bring your own — they hand this off to a
dedicated service on purpose, because credential vaulting is a security domain of its own.

## The right pattern: a token broker

The clean architecture separates the agent from the credentials with a **token broker**:

- The broker holds the OAuth client config and runs the consent flow.
- It vaults each user's tokens, encrypted, and refreshes them automatically.
- Your agent calls provider APIs **through the broker**, identified only by `(provider, user_id)` plus
  a broker API key. The broker injects the user's token server-side and returns the response.

The agent gets a *capability* — "make this call as this user" — never the credential itself. This is
the same principle as a secrets manager: the thing that uses a secret and the thing that stores it are
different systems.

[Grantd](https://github.com/rafavecchi/grantd) is an open-source, MCP-native implementation of
this pattern. The rest of this guide uses it, but the architecture applies regardless of tooling.

## Implementation

### 1. Connect the user (once)

Generate an authorization link for a user and a provider. Send them to it; they consent once.

```ts
import { Grantd } from 'grantd';
const aa = new Grantd({ apiKey: process.env.GRANTD_API_KEY! });

const { url } = await aa.connect({ userId: user.id, provider: 'google' });
// redirect the user to `url`. The broker vaults their tokens on the callback.
```

Note what's **not** here: no webhook. Because you connect the user by *your own* `user.id`, you don't
need an async callback to learn an opaque connection id. After the user finishes, you just call by
their id.

### 2. Act as the user

```ts
// Send an email as the user. The access token is injected server-side; your
// code and the model never see it.
const raw = Buffer.from(
  `To: them@example.com\r\nSubject: Hi\r\n\r\nSent by my agent.`
).toString('base64url');

await aa.proxy({
  userId: user.id,
  provider: 'google',
  method: 'POST',
  path: '/gmail/v1/users/me/messages/send',
  body: { raw },
});
```

`proxy()` forwards your request to the provider with the user's token attached, and returns the
provider's response verbatim. That's the whole call path.

### 3. Handle "not connected yet" gracefully

The killer ergonomic detail: when a user *hasn't* connected, you don't want a cryptic 401. You want a
link to send them. The SDK turns this into a typed error carrying a ready-to-use connect URL:

```ts
import { Grantd, AuthorizationRequiredError } from 'grantd';

try {
  const profile = await aa.proxy({ userId, provider: 'github', path: '/user' });
} catch (e) {
  if (e instanceof AuthorizationRequiredError) {
    // surface this to the user, then retry the action afterward
    return { needsAuth: true, url: e.connectUrl };
  }
  throw e;
}
```

This is the pattern that makes agents feel reliable: an action either happens, or it returns a clear
"ask the user to connect their account here." Never a stack trace.

## Tokens, refresh, and security

A correct broker handles three things you'd otherwise get wrong:

- **Encryption at rest.** Tokens are stored with authenticated encryption (AES-256-GCM). With
  key-versioning, you can rotate keys without downtime.
- **Safe refresh.** When an access token is near expiry, the broker refreshes it — under a lock, with
  a re-check after acquiring the lock — so two concurrent agent calls can't both refresh and
  invalidate a rotating refresh token.
- **Isolation.** The raw token is injected at the network boundary and never returned to the caller on
  the proxy path, so it stays out of your agent and your LLM.

## Using it from a framework

Because `proxy()` is just an async function, it drops into any tool definition. A LangGraph tool that
sends email as the user:

```ts
const sendEmail = tool(async ({ to, subject, body }) => {
  const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`).toString('base64url');
  return aa.proxy({
    userId: ctx.userId, provider: 'google', method: 'POST',
    path: '/gmail/v1/users/me/messages/send', body: { raw },
  });
}, { name: 'send_email', /* schema */ });
```

## Using it from Claude or Cursor (MCP)

If you build with an MCP-capable assistant, point it at the broker's MCP server. Your agent gets tools
like `call_provider` directly. When it tries to act for a user who hasn't connected, it receives an
`authorization_required` result with a connect link — which it surfaces to the user, then retries.

```bash
claude mcp add grantd --env GRANTD_API_KEY=sk_... -- npx grantd-mcp
```

## Summary

Letting an agent act on a user's behalf is an OAuth-and-secrets problem, not an AI problem. Don't store
raw tokens in app code, don't pass them to the model, and don't hand-roll refresh. Put a token broker
between your agent and your users' accounts: connect once, call by `(provider, user_id)`, let the broker
vault and inject. Your agent gets hands; your users' credentials stay safe.

- Open source broker + SDKs: [github.com/rafavecchi/grantd](https://github.com/rafavecchi/grantd)
- Machine-readable reference: [llms.txt](https://github.com/rafavecchi/grantd/blob/main/llms.txt)

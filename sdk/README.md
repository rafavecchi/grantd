# grantd

Let your AI agent securely act on a user's behalf across third-party APIs (Gmail, Slack,
GitHub, Notion…). Tokens are vaulted server-side and never touch your agent or the LLM.

```bash
npm install grantd
```

## The whole thing in 5 lines

```ts
import { Grantd, AuthorizationRequiredError } from 'grantd';

const aa = new Grantd({ apiKey: process.env.GRANTD_API_KEY! });

try {
  // Call any provider API as your user — token injected server-side, never exposed.
  const profile = await aa.proxy({ userId: user.id, provider: 'github', path: '/user' });
  console.log(profile.login);
} catch (e) {
  if (e instanceof AuthorizationRequiredError) {
    // Not connected yet — send the user to e.connectUrl to authorize, then retry.
    redirect(e.connectUrl!);
  }
}
```

That's the wedge: you never handle OAuth, tokens, refresh, or webhooks. If the user isn't
connected, `proxy()` (and `getToken()`) throw an `AuthorizationRequiredError` carrying a
ready-to-use `connectUrl`.

## Sending an email as the user

```ts
const raw = Buffer.from(
  `To: them@example.com\r\nSubject: Hi\r\n\r\nSent by my agent.`,
).toString('base64url');

await aa.proxy({
  userId: user.id,
  provider: 'google',
  method: 'POST',
  path: '/gmail/v1/users/me/messages/send',
  body: { raw },
});
```

## API

```ts
new Grantd({ apiKey, baseUrl?, fetch? })

aa.listProviders(): Promise<ProviderInfo[]>
aa.connect({ userId, provider, scopes?, connectionConfig?, redirectUri? }): Promise<{ url, ... }>
aa.proxy({ userId, provider, path, method?, body?, headers?, query? }): Promise<T>
aa.getToken({ userId, provider, forceRefresh? }): Promise<{ accessToken, expiresAt }>
aa.listConnections(): Promise<Connection[]>
aa.revoke({ userId, provider }): Promise<void>
aa.configureIntegration(provider, { clientId, clientSecret, scopes? }): Promise<void>
```

Errors: `GrantdError` (status, type, details) and `AuthorizationRequiredError`
(adds `connectUrl`, `provider`, `userId`).

MIT.

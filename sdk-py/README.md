# grantd (Python)

Let your AI agent securely act on a user's behalf across third-party APIs (Gmail, Slack,
GitHub, Notion…). Tokens are vaulted server-side and never touch your agent or the LLM.

```bash
pip install grantd
```

## The whole thing in 5 lines

```python
from grantd import Grantd, AuthorizationRequiredError

aa = Grantd(api_key="sk_...")

try:
    profile = aa.proxy(user_id=user.id, provider="github", path="/user")
    print(profile["login"])
except AuthorizationRequiredError as e:
    # Not connected yet — send the user to e.connect_url to authorize, then retry.
    redirect(e.connect_url)
```

You never handle OAuth, tokens, refresh, or webhooks. If the user isn't connected, `proxy()`
and `get_token()` raise `AuthorizationRequiredError` carrying a ready-to-use `connect_url`.

## Send an email as the user

```python
import base64

raw = base64.urlsafe_b64encode(
    b"To: them@example.com\r\nSubject: Hi\r\n\r\nSent by my agent."
).decode()

aa.proxy(
    user_id=user.id,
    provider="google",
    method="POST",
    path="/gmail/v1/users/me/messages/send",
    body={"raw": raw},
)
```

## Async

```python
from grantd import AsyncGrantd

async with AsyncGrantd(api_key="sk_...") as aa:
    profile = await aa.proxy(user_id=user.id, provider="github", path="/user")
```

## API

```python
Grantd(api_key, base_url="http://localhost:8787", timeout=30.0)
AsyncGrantd(...)  # same surface, awaitable

aa.list_providers() -> list[ProviderInfo]
aa.connect(user_id, provider, scopes=None, connection_config=None, redirect_uri=None) -> ConnectResult
aa.proxy(user_id, provider, path, method="GET", body=None, headers=None, query=None) -> Any
aa.get_token(user_id, provider, force_refresh=False) -> TokenResult
aa.list_connections() -> list[Connection]
aa.revoke(user_id, provider) -> None
aa.configure_integration(provider, client_id, client_secret, scopes=None) -> None
```

Errors: `GrantdError` (`.status`, `.type`, `.details`) and `AuthorizationRequiredError`
(adds `.connect_url`, `.provider`, `.user_id`).

MIT.

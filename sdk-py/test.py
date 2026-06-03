"""Exercises the Python SDK against a running broker.
Run with the broker up and GRANTD_API_KEY set:
    python test.py
"""
import asyncio
import os

from grantd import Grantd, AsyncGrantd, AuthorizationRequiredError

api_key = os.environ["GRANTD_API_KEY"]
base = os.environ.get("GRANTD_BASE_URL", "http://localhost:8787")

aa = Grantd(api_key=api_key, base_url=base)

print("providers:", ", ".join(p.slug for p in aa.list_providers()))
print("connections:", ", ".join(f"{c.provider}/{c.user_id}:{c.status}" for c in aa.list_connections()))

gh = aa.proxy(user_id="rafa", provider="github", path="/user")
print("proxy github /user ->", gh["login"], gh["id"])

tok = aa.get_token(user_id="rafa", provider="google", force_refresh=True)
print("get_token google (forced refresh) -> expires_at", tok.expires_at, "| token length", len(tok.access_token))

try:
    aa.proxy(user_id="rafa", provider="slack", path="/auth.test")
    print("ERROR: expected AuthorizationRequiredError for slack")
except AuthorizationRequiredError as e:
    print(f"slack -> AuthorizationRequiredError (type={e.type}, connect_url={'present' if e.connect_url else 'null'})")

aa.close()


async def amain():
    async with AsyncGrantd(api_key=api_key, base_url=base) as c:
        gh2 = await c.proxy(user_id="rafa", provider="github", path="/user")
        print("async proxy github /user ->", gh2["login"])


asyncio.run(amain())

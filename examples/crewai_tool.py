"""A CrewAI tool that acts on the user's behalf via Grantd.

    pip install grantd crewai
    GRANTD_API_KEY=sk_... python crewai_tool.py
"""
import os

from crewai.tools import tool
from grantd import Grantd, AuthorizationRequiredError

grantd = Grantd(api_key=os.environ["GRANTD_API_KEY"])
USER_ID = "user_123"


@tool("GitHub: who am I")
def github_whoami() -> str:
    """Return the connected user's GitHub login, acting as them via Grantd."""
    try:
        return grantd.proxy(user_id=USER_ID, provider="github", path="/user")["login"]
    except AuthorizationRequiredError as e:
        return f"Ask the user to connect GitHub first: {e.connect_url}"


if __name__ == "__main__":
    print(github_whoami.run())

"""LangGraph tools that act on the user's behalf via Grantd.

The agent calls these tools; Grantd injects the user's OAuth token server-side, so the token
never enters the model. If the user hasn't connected the provider, the tool returns an
authorization prompt (with a connect link) instead of failing — surface it to the user, then retry.

    pip install grantd langgraph langchain
    GRANTD_API_KEY=sk_... python langgraph_tool.py
"""
import base64
import os

from grantd import Grantd, AuthorizationRequiredError
from langchain_core.tools import tool

grantd = Grantd(api_key=os.environ["GRANTD_API_KEY"])

# In a real app the user id comes from your auth/session and is threaded into the tools
# (a closure, RunnableConfig, or a context var). Hard-coded here for clarity.
USER_ID = "user_123"


@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email as the user via Gmail."""
    raw = base64.urlsafe_b64encode(
        f"To: {to}\r\nSubject: {subject}\r\n\r\n{body}".encode()
    ).decode()
    try:
        grantd.proxy(
            user_id=USER_ID,
            provider="google",
            method="POST",
            path="/gmail/v1/users/me/messages/send",
            body={"raw": raw},
        )
        return f"Email sent to {to}."
    except AuthorizationRequiredError as e:
        return f"The user must connect their Google account first: {e.connect_url}"


@tool
def github_whoami() -> str:
    """Return the connected user's GitHub login."""
    try:
        return grantd.proxy(user_id=USER_ID, provider="github", path="/user")["login"]
    except AuthorizationRequiredError as e:
        return f"Ask the user to connect GitHub: {e.connect_url}"


if __name__ == "__main__":
    # Bind the tools into any LangGraph agent like normal:
    #   from langgraph.prebuilt import create_react_agent
    #   agent = create_react_agent(model, tools=[send_email, github_whoami])
    print(github_whoami.invoke({}))

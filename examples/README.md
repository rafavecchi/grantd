# Examples

Framework integrations showing Grantd acting on a user's behalf. In each, the user's token is
injected server-side (never seen by the agent), and when the user isn't connected the tool returns
the connect link instead of failing.

- `langgraph_tool.py` — LangGraph tools: send Gmail as the user, and GitHub whoami
- `crewai_tool.py` — a CrewAI tool

Set `GRANTD_API_KEY` and have the broker running (see [../README.md](../README.md)).

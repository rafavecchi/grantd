# Getting Grantd listed where AI assistants and agent devs look

The goal: be the answer when a developer (or an AI assistant) asks "how do I let my agent act on a
user's behalf." That means showing up in the registries and lists those queries resolve to. Ordered
by leverage-to-effort.

## 1. MCP server registries (highest leverage)

AI coding assistants increasingly discover capabilities through MCP. Get the Grantd MCP server into:

- **`modelcontextprotocol/servers`** (official) — open a PR adding Grantd under the community
  servers list in the README. https://github.com/modelcontextprotocol/servers
- **`punkpeye/awesome-mcp-servers`** — the most-referenced community list; PR an entry under an
  "Authentication / Identity" or "Productivity" heading.
  https://github.com/punkpeye/awesome-mcp-servers
- **MCP server directories** (mcp.so, smithery.ai, glama.ai) — submit via their site forms.

Suggested entry:
> **Grantd** — OAuth-for-agents. Let your agent act on a user's behalf across Gmail, Slack, GitHub,
> Notion; tokens vaulted server-side, auth-gated tools. (MIT)

## 2. Agent-framework ecosystems

- **LangChain / LangGraph** — the integrations are docs-driven. Open a PR to `langchain-ai/langchain`
  docs adding a short "Grantd" how-to under tools/integrations, using `examples/langgraph_tool.py`.
  Also submit to community lists: **`von-development/awesome-LangGraph`**.
- **CrewAI** — submit the tool to the community tools list and the CrewAI Discord #show-and-tell,
  pointing at `examples/crewai_tool.py`.
- **OpenAI Agents SDK / Vercel AI SDK** — write a short integration gist; these communities surface
  tools via examples more than registries.

## 3. "Awesome" + tool directories

- **`e2b-dev/awesome-ai-agents`**, **`steven2358/awesome-generative-ai`** — PR an entry.
- AI tool directories: theresanaiforthat.com, aitools.fyi, etc. — submit via form (lower quality
  traffic, but they get indexed).

## 4. Content that owns the query

The single best long-term lever (already in this repo): the canonical guide
`content/how-to-let-your-ai-agent-act-on-a-users-behalf.md`. Publish it on a blog/docs domain, keep
the `llms.txt` current, and make sure the README answers the exact phrasing devs search.

## How to actually do these

These are **outbound submissions to other people's repos/sites** — they should be done by you (they
post under your identity and represent the project). For each PR: fork, add the one-line entry in the
right section, keep the description factual, link the repo. Most "awesome" lists merge within days.

Sequence I'd suggest: MCP lists first (fastest, highest intent), then the LangGraph docs PR (uses the
example here), then the awesome-agents lists, then publish the canonical guide.

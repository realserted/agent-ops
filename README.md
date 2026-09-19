# agent-ops

An AI operations agent that triages a business inbox: it classifies emails, extracts structured records, drafts replies, and flags suspicious messages. Irreversible actions pause for human approval.

Built with a hand-written agent loop (no agent framework), a provider-agnostic LLM layer, and typed tools.

## Architecture

```
packages/
  llm/     Provider interface + Gemini and Anthropic adapters (fetch only, retries with backoff)
  core/    Agent loop, tool registry, approval gate
  tools/   Operations tools, plus ports (InboxSource, OperationsStore) and adapters
apps/
  cli/     Terminal runner with interactive approvals
```

Tools depend on ports, not implementations. The fixture inbox and in-memory store are swapped for Gmail and Supabase without touching the agent or the tools.

## Quick start

```bash
pnpm install
cp .env.example .env   # add GEMINI_API_KEY
pnpm agent             # triage the fixture inbox
pnpm agent "Only handle invoices"
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm agent [task]` | Run the agent from the terminal |
| `pnpm typecheck` | Strict TypeScript check |
| `pnpm test` | Unit tests (offline, scripted LLM) |

## Roadmap

- [x] Agent loop, LLM adapters, tools, CLI, tests, CI
- [ ] Eval harness in CI
- [ ] Tracing and cost accounting (MongoDB)
- [ ] MCP server
- [ ] Gmail and Supabase adapters
- [ ] Next.js dashboard with approval queue and trace viewer

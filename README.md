# agent-ops

[![CI](https://github.com/realserted/agent-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/realserted/agent-ops/actions/workflows/ci.yml)
[![Security](https://github.com/realserted/agent-ops/actions/workflows/security.yml/badge.svg)](https://github.com/realserted/agent-ops/actions/workflows/security.yml)
[![Coverage](https://img.shields.io/badge/coverage-99%25%20lines-brightgreen)](vitest.config.ts)

An AI operations agent that triages a business inbox: it classifies emails, extracts structured records, drafts replies, and flags suspicious messages. Irreversible actions pause for human approval.

Built with a hand-written agent loop (no agent framework), a provider-agnostic LLM layer, and typed tools.

## Architecture

```
packages/
  llm/      Provider interface + Gemini and Anthropic adapters (fetch only, retries with backoff)
  core/     Agent loop, tool registry, approval gate, guardrails
  tools/    Operations tools, ports (InboxSource, OperationsStore), adapters, system prompt
  evals/    Adversarial eval cases, grading and scoreboards
  tracing/  Trace port, cost accounting, in-memory and MongoDB adapters
apps/
  cli/      Terminal runner with interactive approvals
  evals/    Eval runner against a real model
  dashboard/ Next.js approval queue and trace viewer
  mcp/      MCP server over stdio
```

Tools depend on ports, not implementations. The fixture inbox and in-memory store swap for Gmail and Supabase in the composition root alone — no tool, guardrail or agent code changes. See [docs/ADAPTERS.md](docs/ADAPTERS.md) for the schema, the OAuth scope, and the row-level security policy.

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
| `pnpm test` | Unit, integration and adversarial tests (offline, scripted LLM) |
| `pnpm test:watch` | Tests in watch mode |
| `pnpm test:coverage` | Tests with coverage thresholds (80% lines, 80% functions, 75% branches) |
| `pnpm eval [case-id...]` | Run the adversarial evals against a real model (costs API calls) |
| `pnpm mcp` | Serve the operations tools over MCP on stdio |
| `pnpm dashboard` | Run the approval queue and trace viewer on :3100 |
| `pnpm e2e` | Playwright end-to-end tests against the dashboard (stubbed LLM) |

If Playwright cannot download its bundled browser — some networks block the Chrome for Testing CDN — drive an already-installed one instead: `PLAYWRIGHT_CHANNEL=chrome pnpm e2e` (or `msedge`). CI leaves the variable unset and uses the pinned bundled build.

## Security and guardrails

The agent reads attacker-controlled text, so the controls are part of the design rather than a wrapper around it:

- **Untrusted-content boundary** — email content is wrapped before the model sees it, and boundary markers inside a body are redacted so it cannot fake an early close.
- **Approval gate** — `create_record` requires a human, deny-by-default. No text in an inbox can install or disable the approver.
- **Output guardrails** — `draft_reply` rejects links absent from the email being replied to, and anything shaped like a credential.
- **Budgets** — per-run caps on steps, tool calls and tokens, plus per-call timeouts and loop detection.
- **Injection heuristics** — a signal that raises warnings and events; deliberately never a block.

Six attack classes are exercised end to end by a scripted model that has already been injected. See [SECURITY.md](SECURITY.md) for the threat model and control map, and [docs/ADVERSARIAL_CASES.md](docs/ADVERSARIAL_CASES.md) for each attack, its control, and the accepted limitations.

Those same six cases run against a real model via `pnpm eval`, which answers the complementary question: the offline suite proves the system holds when the model fails, the eval measures whether the model resists at all. It grants every approval on purpose, so a passing case means the model declined the attack rather than the gate having blocked it. Latest scoreboard: [docs/evals/SCOREBOARD.md](docs/evals/SCOREBOARD.md).

## MCP server

The same operations tools are available to any MCP host over stdio:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "agent-ops": {
      "command": "pnpm",
      "args": ["mcp"],
      "env": { "MCP_WRITE_TOOLS": "true" }  // omit for read-only
    }
  }
}
```

Write tools are **off by default**. An MCP host calls tools on the model's say-so, and this project's rule is that approval is deny-by-default, so exposing `create_record`, `draft_reply` and `flag_for_review` is an explicit opt-in. The tool guardrails still apply — a draft containing a foreign link or a credential is rejected through MCP exactly as it is inside the agent, and email content still arrives wrapped as `untrusted_content`.

## Roadmap

- [x] Agent loop, LLM adapters, tools, CLI, tests, CI
- [x] Eval harness in CI
- [x] Tracing and cost accounting (MongoDB)
- [x] MCP server
- [x] Gmail and Supabase adapters
- [x] Next.js dashboard with approval queue and trace viewer

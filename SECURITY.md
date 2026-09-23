# Security

agent-ops reads attacker-controlled text and can take actions on the strength of it. This document states what is being protected, where the trust boundaries sit, which threats are in scope, and the control that addresses each — with the code and tests that implement it.

## Assets

| Asset | Why it matters |
| --- | --- |
| Inbox content | Third-party business correspondence: invoices, customer details, support history |
| Extracted records | Structured business data the agent creates — invoices, leads, tickets |
| Drafted replies | Text that may be sent to a customer under the operator's name |
| Provider API keys | `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`; disclosure means billable abuse |

## Trust boundaries

Three, and everything below follows from them:

1. **Email content is untrusted.** Bodies, subjects and senders are written by whoever sent the mail. Tools returning it set `untrustedOutput: true`, and the agent wraps it before the model sees it.
2. **Model output is untrusted.** The model may be wrong, or injected. Every tool call is schema-validated, budgeted, and — for consequential actions — gated on a human.
3. **The human approver is the trust anchor.** The approval gate is a function the operator supplies at construction. No text reaching the model can install, replace or disable it.

## Threats and controls

Mapped to the [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/).

### LLM01 Prompt injection

An email instructs the model to ignore its rules, impersonate the system, or act on the sender's behalf.

| Control | Code | Tests |
| --- | --- | --- |
| Untrusted-content envelope; boundary markers in the payload are redacted so a body cannot fake an early close | [`guardrails/untrusted.ts`](packages/core/src/guardrails/untrusted.ts) | [`untrusted.test.ts`](packages/core/test/guardrails/untrusted.test.ts), [`adversarial.test.ts`](packages/tools/test/adversarial.test.ts) `adv_004` |
| System prompt states that `untrusted_content` is data, never instructions | [`config.ts`](apps/cli/src/config.ts) | [`config.test.ts`](apps/cli/test/config.test.ts) |
| Injection heuristics attach warnings and emit a `guardrail` event — a signal, never a block | [`guardrails/injection.ts`](packages/core/src/guardrails/injection.ts) | [`injection.test.ts`](packages/core/test/guardrails/injection.test.ts) |
| Approval gate holds regardless of what any email claims | [`agent.ts`](packages/core/src/agent.ts) | [`adversarial.test.ts`](packages/tools/test/adversarial.test.ts) `adv_001`, `adv_005` |

### LLM02 Sensitive information disclosure

Credentials or other customers' data leaving the system.

| Control | Code | Tests |
| --- | --- | --- |
| `draft_reply` rejects a body matching a credential shape | [`operations-tools.ts`](packages/tools/src/operations-tools.ts), [`guardrails/secrets.ts`](packages/core/src/guardrails/secrets.ts) | [`adversarial.test.ts`](packages/tools/test/adversarial.test.ts) `adv_006` |
| Provider error bodies are truncated and redacted before reaching an error, log or terminal | [`redact.ts`](packages/llm/src/redact.ts) | [`redact.test.ts`](packages/llm/test/redact.test.ts) |
| Adapter error bodies are redacted too, so a Gmail or Supabase response echoing the request cannot carry a credential into a log | [`adapters/http.ts`](packages/tools/src/adapters/http.ts) | [`http.test.ts`](packages/tools/test/http.test.ts) |
| Env validation names the offending variable and never echoes its value | [`env.ts`](packages/llm/src/env.ts) | [`env.test.ts`](packages/llm/test/env.test.ts) |
| `list_emails` never returns bodies | [`operations-tools.ts`](packages/tools/src/operations-tools.ts) | [`operations-tools.test.ts`](packages/tools/test/operations-tools.test.ts) |
| `.env` is gitignored; CI runs gitleaks over full history | [`.gitignore`](.gitignore), [`security.yml`](.github/workflows/security.yml) | — |

### LLM06 Excessive agency

The agent doing more than the task requires, or acting where a human should.

| Control | Code | Tests |
| --- | --- | --- |
| `create_record` requires human approval; deny-by-default with no approver configured | [`agent.ts`](packages/core/src/agent.ts) | [`agent.test.ts`](packages/core/test/agent.test.ts) |
| `draft_reply` rejects URLs absent from the email being replied to, blocking cross-email link planting | [`operations-tools.ts`](packages/tools/src/operations-tools.ts) | [`adversarial.test.ts`](packages/tools/test/adversarial.test.ts) `adv_003` |
| `allowedTools` restricts a run to a named subset | [`agent.ts`](packages/core/src/agent.ts) | [`agent-guardrails.test.ts`](packages/core/test/agent-guardrails.test.ts) |
| Argument hardening bounds ids, bodies, reasons and field counts | [`operations-tools.ts`](packages/tools/src/operations-tools.ts) | [`operations-tools.test.ts`](packages/tools/test/operations-tools.test.ts) |

### LLM10 Unbounded consumption

A runaway loop or an injected instruction driving cost.

| Control | Code | Tests |
| --- | --- | --- |
| Per-run budgets: 15 steps, 40 tool calls, 200k tokens | [`guardrails/budgets.ts`](packages/core/src/guardrails/budgets.ts) | [`budgets.test.ts`](packages/core/test/guardrails/budgets.test.ts) |
| Loop detection on identical repeated calls | [`guardrails/loop.ts`](packages/core/src/guardrails/loop.ts) | [`loop.test.ts`](packages/core/test/guardrails/loop.test.ts) |
| Per-call timeouts: 15s tool, 60s model, via `AbortSignal.timeout` | [`agent.ts`](packages/core/src/agent.ts), [`http.ts`](packages/llm/src/http.ts) | [`agent-guardrails.test.ts`](packages/core/test/agent-guardrails.test.ts) |
| Bounded retries with exponential backoff | [`http.ts`](packages/llm/src/http.ts) | [`http.test.ts`](packages/llm/test/http.test.ts) |
| Trailing-character trimming scans rather than matches, so a crafted link cannot drive quadratic backtracking | [`guardrails/urls.ts`](packages/core/src/guardrails/urls.ts) | [`urls.test.ts`](packages/core/test/guardrails/urls.test.ts) |

## Known limitations

Stated so they are choices rather than oversights. [`docs/ADVERSARIAL_CASES.md`](docs/ADVERSARIAL_CASES.md) covers these in detail.

- **Prose exfiltration into a draft is not blocked.** The output guardrails inspect URLs and credential shapes, not meaning. A draft summarising other customers' data is written; it is never sent, and the injection warning is what draws a reviewer's eye.
- **Detection heuristics are evadable by construction.** Building the adversarial suite found two live bypasses in patterns that unit tests had passed. Assume more exist — this is why enforcement, not detection, is the control.
- **Regex over untrusted text is a recurring denial-of-service surface.** CodeQL found a quadratic trim in `extractUrls`: a link followed by 64,000 dots took 6.5 seconds, in a guardrail that reads every email. It is fixed by scanning instead of matching, and the lesson generalises — any anchored quantifier applied to sender-controlled text is a candidate. The CodeQL workflow is the control that keeps finding them.
- **The in-memory store and fixture inbox are not production adapters.** Gmail and Supabase adapters would introduce real network and data-at-rest concerns not modelled here.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/realserted/agent-ops/security/advisories/new) on this repository. Please do not open a public issue for an unfixed vulnerability.

Include what you were able to do, the steps to reproduce it, and which control you bypassed. A working adversarial email is the most useful possible report — it becomes a fixture in `packages/tools/fixtures/adversarial-emails.json` and a regression test.

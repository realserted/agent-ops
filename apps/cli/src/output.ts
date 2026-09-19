import type { AgentEvent, AgentRunResult } from "@agent-ops/core";
import { formatCost } from "@agent-ops/tracing";

const MAX_PREVIEW = 160;

const preview = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}...` : text;
};

export function printEvent(event: AgentEvent): void {
  const prefix = `[step ${event.step}]`;

  if (event.type === "llm_response") {
    const tokens = `${event.usage.inputTokens} in / ${event.usage.outputTokens} out`;
    console.log(`\n${prefix} model responded in ${Math.round(event.durationMs)}ms (${tokens})`);
    for (const call of event.toolCalls) console.log(`  -> ${call.name}(${preview(call.args)})`);
    return;
  }

  if (event.type === "guardrail") {
    console.log(`  !! ${event.tool} flagged: ${event.warnings.join(", ")}`);
    return;
  }

  const status = event.result.isError ? "ERROR" : "ok";
  console.log(`  <- ${event.result.name} [${status}] ${preview(event.result.output)}`);
}

export function printSummary(result: AgentRunResult, cost?: number): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Run ${result.runId}: ${result.status} in ${result.steps} steps`);
  console.log(
    `Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out` +
      (cost === undefined ? "" : ` (${formatCost(cost)})`),
  );
  console.log(`${"=".repeat(60)}\n`);
  console.log(result.output || "(no final answer: step limit reached)");
}

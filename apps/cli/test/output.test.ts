import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentRunResult } from "@agent-ops/core";
import { printEvent, printSummary } from "../src/output";

let lines: string[];

const printed = () => lines.join("\n");

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const llmResponse = (overrides: Partial<Extract<AgentEvent, { type: "llm_response" }>> = {}): AgentEvent => ({
  type: "llm_response",
  step: 1,
  content: "",
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5 },
  durationMs: 1234.6,
  ...overrides,
});

const toolResult = (output: unknown, isError = false): AgentEvent => ({
  type: "tool_result",
  step: 1,
  result: { callId: "c1", name: "get_email", output, isError },
  durationMs: 12,
});

const runResult = (overrides: Partial<AgentRunResult> = {}): AgentRunResult => ({
  runId: "run_abc",
  status: "completed",
  output: "All done.",
  steps: 3,
  usage: { inputTokens: 100, outputTokens: 40 },
  messages: [],
  ...overrides,
});

describe("printEvent", () => {
  it("reports the step, rounded duration and token usage for a model turn", () => {
    printEvent(llmResponse({ step: 2 }));

    expect(printed()).toContain("[step 2] model responded in 1235ms (10 in / 5 out)");
  });

  it("lists each tool call with its arguments", () => {
    printEvent(
      llmResponse({
        toolCalls: [
          { id: "c1", name: "get_email", args: { email_id: "em_001" } },
          { id: "c2", name: "list_emails", args: {} },
        ],
      }),
    );

    expect(printed()).toContain('-> get_email({"email_id":"em_001"})');
    expect(printed()).toContain("-> list_emails({})");
  });

  it("marks a successful tool result as ok", () => {
    printEvent(toolResult({ sum: 5 }));

    expect(printed()).toContain('<- get_email [ok] {"sum":5}');
  });

  it("marks a failed tool result as ERROR", () => {
    printEvent(toolResult({ error: "boom" }, true));

    expect(printed()).toContain('<- get_email [ERROR] {"error":"boom"}');
  });

  it("prints string output without JSON quoting", () => {
    printEvent(toolResult("plain text"));

    expect(printed()).toContain("<- get_email [ok] plain text");
  });

  it("surfaces a guardrail warning with the tool that triggered it", () => {
    printEvent({
      type: "guardrail",
      step: 2,
      tool: "get_email",
      warnings: ["role_impersonation", "instruction_override"],
    });

    expect(printed()).toContain("!! get_email flagged: role_impersonation, instruction_override");
  });

  it("truncates output longer than 160 characters", () => {
    printEvent(toolResult("x".repeat(200)));

    expect(printed()).toContain(`${"x".repeat(160)}...`);
    expect(printed()).not.toContain("x".repeat(161));
  });

  it("leaves output of exactly 160 characters intact", () => {
    printEvent(toolResult("y".repeat(160)));

    expect(printed()).toContain("y".repeat(160));
    expect(printed()).not.toContain("...");
  });
});

describe("printSummary", () => {
  it("reports the run id, status, steps and token totals", () => {
    printSummary(runResult());

    expect(printed()).toContain("Run run_abc: completed in 3 steps");
    expect(printed()).toContain("Tokens: 100 in / 40 out");
    expect(printed()).toContain("All done.");
  });

  it("appends the estimated cost when the model is priced", () => {
    printSummary(runResult(), 0.00042);

    expect(printed()).toContain("Tokens: 100 in / 40 out ($0.00042)");
  });

  it("omits the cost entirely when the model has no published price", () => {
    printSummary(runResult(), undefined);

    expect(printed()).toContain("Tokens: 100 in / 40 out");
    expect(printed()).not.toContain("unpriced");
    expect(printed()).not.toContain("$");
  });

  it("explains an empty answer when the step limit was reached", () => {
    printSummary(runResult({ status: "max_steps", output: "", steps: 15 }));

    expect(printed()).toContain("Run run_abc: max_steps in 15 steps");
    expect(printed()).toContain("(no final answer: step limit reached)");
  });
});

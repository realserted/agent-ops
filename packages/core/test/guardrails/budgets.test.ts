import { describe, expect, it } from "vitest";
import { checkBudgets, DEFAULT_LIMITS } from "../../src/guardrails/budgets";

const spend = (toolCalls: number, totalTokens: number) => ({ toolCalls, totalTokens });

describe("DEFAULT_LIMITS", () => {
  it("matches the values documented in the hardening plan", () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxSteps: 15,
      maxToolCalls: 40,
      maxTotalTokens: 200_000,
      toolTimeoutMs: 15_000,
      llmTimeoutMs: 60_000,
    });
  });
});

describe("checkBudgets", () => {
  it("allows a run well inside both budgets", () => {
    expect(checkBudgets(spend(5, 1_000), DEFAULT_LIMITS)).toBeUndefined();
  });

  it("allows a run one call below the tool budget", () => {
    expect(checkBudgets(spend(39, 0), DEFAULT_LIMITS)).toBeUndefined();
  });

  it("stops the run when the tool budget is reached", () => {
    expect(checkBudgets(spend(40, 0), DEFAULT_LIMITS)).toMatch(/Tool call budget exhausted \(40\/40\)/);
  });

  it("stops the run when the token budget is reached", () => {
    expect(checkBudgets(spend(0, 200_000), DEFAULT_LIMITS)).toMatch(/Token budget exhausted/);
  });

  it("reports the tool budget first when both are exhausted", () => {
    expect(checkBudgets(spend(40, 200_000), DEFAULT_LIMITS)).toMatch(/Tool call budget/);
  });

  it("honours overridden limits", () => {
    expect(checkBudgets(spend(2, 0), { ...DEFAULT_LIMITS, maxToolCalls: 2 })).toMatch(/2\/2/);
  });
});

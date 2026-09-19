import { describe, expect, it } from "vitest";
import { estimateCost, formatCost, PRICES, PRICES_UPDATED } from "../src/cost";

describe("estimateCost", () => {
  it("prices a run from published per-million rates", () => {
    // 1M in at $1 plus 1M out at $5.
    expect(estimateCost("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(6);
  });

  it("scales linearly below a million tokens", () => {
    expect(estimateCost("claude-haiku-4-5", { inputTokens: 10_000, outputTokens: 2_000 })).toBeCloseTo(0.02, 10);
  });

  it("returns zero for a run that used no tokens", () => {
    expect(estimateCost("claude-haiku-4-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  // The important case: a wrong number is worse than no number, because a
  // cost report that invents figures gets believed.
  it("returns undefined for a model with no published price", () => {
    expect(estimateCost("some-future-model", { inputTokens: 1_000, outputTokens: 1_000 })).toBeUndefined();
  });

  it("prices every model in the table", () => {
    for (const model of Object.keys(PRICES)) {
      expect(estimateCost(model, { inputTokens: 1_000, outputTokens: 1_000 }), model).toBeGreaterThan(0);
    }
  });

  it("records when prices were last checked", () => {
    expect(PRICES_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatCost", () => {
  it("distinguishes an unpriced run from a free one", () => {
    expect(formatCost(undefined)).toBe("unpriced");
    expect(formatCost(0)).toBe("$0.00000");
  });

  it("shows enough decimals for sub-cent runs to be visible", () => {
    expect(formatCost(0.00042)).toBe("$0.00042");
  });

  it("uses four decimals once a run costs more than a cent", () => {
    expect(formatCost(1.23456)).toBe("$1.2346");
  });
});

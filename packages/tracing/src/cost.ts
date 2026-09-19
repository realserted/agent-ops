import type { TokenUsage } from "@agent-ops/core";

export interface ModelPrice {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

/**
 * Published list prices, keyed by the model id the provider is configured with.
 *
 * Deliberately not a fallback-to-average table: an unknown model returns no
 * estimate rather than a plausible-looking wrong number. A cost report that
 * silently invents figures is worse than one that says it does not know.
 *
 * These are list prices and go stale. `PRICES_UPDATED` records when they were
 * last checked so a reader can judge how much to trust a total.
 */
export const PRICES_UPDATED = "2026-09-19";

export const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
};

/**
 * Cost in USD, or `undefined` when the model's price is unknown.
 *
 * Callers must handle `undefined` rather than defaulting to zero: a run that
 * reports $0.00 reads as free, not as unpriced.
 */
export function estimateCost(model: string, usage: TokenUsage): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;

  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMTok +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok
  );
}

/** Formats a cost for display, distinguishing "free" from "not priced". */
export function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "unpriced";
  // Sub-cent runs are the norm here, so two decimals would show $0.00 for
  // everything and make the column useless.
  return `$${cost.toFixed(cost < 0.01 ? 5 : 4)}`;
}

export interface RunLimits {
  /** Model turns before the run stops. */
  maxSteps: number;
  /** Tool invocations across the whole run. */
  maxToolCalls: number;
  /** Input plus output tokens across the whole run. */
  maxTotalTokens: number;
  /** Wall clock allowed for a single tool call. */
  toolTimeoutMs: number;
  /** Wall clock allowed for a single model call. */
  llmTimeoutMs: number;
}

export const DEFAULT_LIMITS: RunLimits = {
  maxSteps: 15,
  maxToolCalls: 40,
  maxTotalTokens: 200_000,
  toolTimeoutMs: 15_000,
  llmTimeoutMs: 60_000,
};

export interface RunSpend {
  toolCalls: number;
  totalTokens: number;
}

/**
 * Returns a human-readable reason when the run has exhausted a budget, or
 * `undefined` while it is still within them.
 *
 * Checked before each model turn rather than after, so the run stops without
 * spending one more request than the budget allows.
 */
export function checkBudgets(spend: RunSpend, limits: RunLimits): string | undefined {
  if (spend.toolCalls >= limits.maxToolCalls) {
    return `Tool call budget exhausted (${spend.toolCalls}/${limits.maxToolCalls}).`;
  }
  if (spend.totalTokens >= limits.maxTotalTokens) {
    return `Token budget exhausted (${spend.totalTokens}/${limits.maxTotalTokens}).`;
  }
  return undefined;
}

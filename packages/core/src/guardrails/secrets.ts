import { redactSecrets as redact, SECRET_PATTERNS } from "@agent-ops/llm";

/**
 * Secret-shape detection for outbound text.
 *
 * Unlike the injection heuristics this one does block, because it guards a
 * narrow, high-consequence boundary: text the agent proposes to send to a third
 * party. A false positive costs a rejected draft; a false negative leaks a key.
 *
 * The patterns come from `@agent-ops/llm`, which owns credential shapes because
 * it is the layer that handles credentials. Sharing one list keeps detection
 * here and redaction there from drifting apart.
 */
export function detectSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/**
 * Replaces anything shaped like a credential with a placeholder.
 *
 * Re-exported through core so `packages/tools` can redact without taking a
 * direct dependency on the llm layer, and so detection and redaction keep
 * sharing one pattern list rather than drifting apart.
 */
export function redactSecrets(text: string): string {
  return redact(text);
}

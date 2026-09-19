/**
 * Secret-shape detection for outbound text.
 *
 * Unlike the injection heuristics this one does block, because it guards a
 * narrow, high-consequence boundary: text the agent proposes to send to a third
 * party. A false positive costs a rejected draft; a false negative leaks a key.
 */
const PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "private_key_header", pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: "openai_key", pattern: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: "google_key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { name: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/ },
];

/** Returns the names of every secret pattern present in `text`. */
export function detectSecrets(text: string): string[] {
  return PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/**
 * Credential shapes, owned by the package that handles credentials.
 *
 * `packages/core` re-uses this list for its outbound draft guardrail. The list
 * lives here rather than there because core depends on llm, not the reverse —
 * duplicating the patterns would let the two drift apart, and a shape missing
 * from one copy is a leak.
 */
export const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "private_key_header", pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: "openai_key", pattern: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: "google_key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { name: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/ },
];

/** Upstream error bodies can be enormous; keep enough to debug, not to flood a log. */
export const MAX_ERROR_BODY = 2_000;

export const REDACTED = "[redacted]";

/**
 * Replaces anything shaped like a credential with a placeholder.
 *
 * Provider error responses can echo the request, and the request carries the
 * API key. Without this, a 400 from upstream would put the key into an
 * exception message, a log line, and the operator's terminal.
 */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (current, { pattern }) => current.replace(new RegExp(pattern.source, `${pattern.flags}g`), REDACTED),
    text,
  );
}

/** Truncates to `max` characters, marking that it happened. */
export function truncate(text: string, max = MAX_ERROR_BODY): string {
  return text.length > max ? `${text.slice(0, max)}... [truncated ${text.length - max} chars]` : text;
}

/** Makes an upstream response body safe to put in an error message or a log. */
export function safeBody(text: string): string {
  return redactSecrets(truncate(text));
}

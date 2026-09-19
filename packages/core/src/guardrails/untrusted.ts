/** The key the model is taught to treat as a third-party data boundary. */
export const UNTRUSTED_KEY = "untrusted_content";

const BOUNDARY_PATTERN = new RegExp(UNTRUSTED_KEY, "gi");

export interface UntrustedEnvelope {
  [UNTRUSTED_KEY]: string;
}

/**
 * Wraps tool output that originated outside the system so the model can tell
 * data from instructions.
 *
 * The payload is serialized to a single string rather than nested as an object:
 * a nested shape invites the model to read inner keys as structure it should
 * act on. Any text inside the payload that names the boundary key is defanged
 * first, so an email cannot print a convincing "end of untrusted content"
 * marker and have the rest of its body read as operator instructions.
 */
export function wrapUntrusted(output: unknown): UntrustedEnvelope {
  const serialized = typeof output === "string" ? output : JSON.stringify(output) ?? "null";
  return { [UNTRUSTED_KEY]: serialized.replace(BOUNDARY_PATTERN, "[redacted-boundary]") };
}

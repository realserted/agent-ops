/**
 * Minimal JSON transport for the external adapters.
 *
 * Deliberately not `postJson` from `@agent-ops/llm`: that one exists for LLM
 * calls and carries retry semantics tuned to provider rate limits, and reusing
 * it would make `packages/tools` depend on the llm layer for no reason. These
 * are ordinary CRUD calls against Gmail and PostgREST.
 */
export class AdapterHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "AdapterHttpError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
}

const MAX_ERROR_BODY = 1_000;

export async function requestJson<T>(
  url: string,
  { method = "GET", headers = {}, body, timeoutMs = 30_000 }: RequestOptions = {},
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    // Truncated: an upstream error body can be large, and it may echo the
    // request, which carries the credential.
    const text = (await response.text()).slice(0, MAX_ERROR_BODY);
    throw new AdapterHttpError(`${method} failed (${response.status})`, response.status, text);
  }

  // 204 and other empty responses are valid successes for a write.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

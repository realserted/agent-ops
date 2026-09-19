const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class LLMHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "LLMHttpError";
  }
}

interface PostJsonOptions {
  headers: Record<string, string>;
  maxRetries?: number;
  baseDelayMs?: number;
  /** Abort each attempt after this many milliseconds. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST JSON with exponential backoff on rate limits and transient server errors. */
export async function postJson<T>(
  url: string,
  body: unknown,
  { headers, maxRetries = 3, baseDelayMs = 1000, timeoutMs }: PostJsonOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      // A fresh signal per attempt: one shared signal would already be expired
      // for every retry after the first.
      ...(timeoutMs !== undefined && { signal: AbortSignal.timeout(timeoutMs) }),
    });

    if (response.ok) return (await response.json()) as T;

    const text = await response.text();
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries) {
      throw new LLMHttpError(`LLM request failed (${response.status}): ${text}`, response.status, text);
    }
    await sleep(baseDelayMs * 2 ** attempt);
  }
}

/** Providers expect tool results as JSON objects; wrap primitives and arrays. */
export function toJsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value ?? null };
}

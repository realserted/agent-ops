/**
 * Turns a provider error into something an operator can act on.
 *
 * Providers return their failures as JSON blobs meant for machines; dumping one
 * into the page tells you something broke without telling you what to do. The
 * quota case matters most here, because it is not a fault to fix - it is a
 * limit to wait out, and the useful information is which limit and for how long.
 */
export interface ReadableError {
  headline: string;
  detail?: string;
  raw: string;
}

const seconds = (raw: string): string | undefined => {
  const match = /"retryDelay":\s*"(\d+)s"/.exec(raw) ?? /retry in ([\d.]+)s/.exec(raw);
  if (!match) return undefined;
  return `${Math.ceil(Number(match[1]))}s`;
};

export function describeRunError(raw: string): ReadableError {
  if (/\b429\b|RESOURCE_EXHAUSTED/.test(raw)) {
    const perDay = /GenerateRequestsPerDayPerProjectPerModel/.test(raw);
    const wait = seconds(raw);
    return {
      headline: perDay ? "Daily quota used up" : "Rate limit reached",
      detail: perDay
        ? "This model's free tier allows 20 requests a day, and a triage run uses several. It resets on the provider's clock — switch models to keep going now."
        : `Too many requests in a short window.${wait ? ` Retry in about ${wait}.` : ""}`,
      raw,
    };
  }

  if (/\b401\b|\b403\b|invalid.{0,10}key|API key/i.test(raw)) {
    return {
      headline: "The provider rejected the credentials",
      detail: "Check the key for this provider in your .env, then restart the dashboard.",
      raw,
    };
  }

  if (/timed out|ETIMEDOUT|AbortError/i.test(raw)) {
    return { headline: "The provider did not respond in time", raw };
  }

  // Unknown shape: show the first line, keep the rest behind the details toggle.
  return { headline: raw.split("\n")[0]?.slice(0, 160) ?? "The run failed", raw };
}

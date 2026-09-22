import { describe, expect, it } from "vitest";
import { describeRunError } from "../src/lib/errors";

const DAILY_QUOTA = `LLM request failed (429): {"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"},{"retryDelay":"23s"}]}}`;
const PER_MINUTE = `LLM request failed (429): quota exceeded, Please retry in 46.38s.`;

describe("describeRunError", () => {
  // The distinction matters: one is a wait of seconds, the other of hours.
  it("names the daily quota and says a different model is the way forward", () => {
    const { headline, detail } = describeRunError(DAILY_QUOTA);

    expect(headline).toBe("Daily quota used up");
    expect(detail).toContain("20 requests a day");
    expect(detail).toContain("switch models");
  });

  it("treats a short-window limit as something to wait out, with the wait", () => {
    const { headline, detail } = describeRunError(PER_MINUTE);

    expect(headline).toBe("Rate limit reached");
    expect(detail).toContain("47s");
  });

  it("explains a rejected key without echoing it", () => {
    const { headline, detail } = describeRunError("LLM request failed (401): invalid api key");

    expect(headline).toMatch(/rejected the credentials/);
    expect(detail).toContain(".env");
  });

  it("reports a timeout plainly", () => {
    expect(describeRunError("Request timed out after 60000ms").headline).toMatch(/did not respond in time/);
  });

  it("falls back to the first line of an unfamiliar error", () => {
    const { headline } = describeRunError("Something unexpected\nwith more detail below");

    expect(headline).toBe("Something unexpected");
  });

  // The summary is a convenience, never a replacement - the operator can always
  // read what the provider actually said.
  it("always keeps the provider's own response", () => {
    expect(describeRunError(DAILY_QUOTA).raw).toBe(DAILY_QUOTA);
  });
});

import { describe, expect, it } from "vitest";
import { extractUrls } from "../../src/guardrails/urls";

describe("extractUrls", () => {
  it("finds http and https links", () => {
    expect(extractUrls("See http://a.test/x and https://b.test/y")).toEqual(["a.test/x", "b.test/y"]);
  });

  it("finds bare www links", () => {
    expect(extractUrls("visit www.example.test/pricing")).toEqual(["example.test/pricing"]);
  });

  it("normalises scheme, www and trailing slash to the same key", () => {
    const [a] = extractUrls("http://www.example.test/pricing/");
    const [b] = extractUrls("https://example.test/pricing");

    expect(a).toBe(b);
  });

  it("is case insensitive", () => {
    expect(extractUrls("HTTPS://Example.TEST/Path")).toEqual(["example.test/path"]);
  });

  it("strips sentence punctuation that follows a link", () => {
    expect(extractUrls("Go to https://example.test/docs.")).toEqual(["example.test/docs"]);
    expect(extractUrls("(see https://example.test/a)")).toEqual(["example.test/a"]);
  });

  it("deduplicates repeated links", () => {
    expect(extractUrls("https://a.test and http://www.a.test/")).toEqual(["a.test"]);
  });

  it("returns an empty array when there are no links", () => {
    expect(extractUrls("Please call me on 555-0100 instead.")).toEqual([]);
  });

  // Regression: the trailing-punctuation and trailing-slash trims were anchored
  // regex quantifiers, which are quadratic. The URL matcher admits . , ; : ! ?
  // so a sender could reach them directly - 64k dots took 6.5 seconds, a denial
  // of service in a guardrail that reads every email. Generous bound so a
  // loaded CI box does not flake; the point is orders of magnitude, not ms.
  it.each([
    ["trailing punctuation", "."],
    ["trailing slashes", "/"],
  ])("handles a 64k run of %s in linear time", (_label, character) => {
    const payload = `Visit http://a.test/${character.repeat(64_000)}x now`;

    const started = performance.now();
    const found = extractUrls(payload);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(250);
    expect(found).toHaveLength(1);
  });

  it("does not treat an email address as a link", () => {
    expect(extractUrls("Reach me at ops@example.test")).toEqual([]);
  });
});

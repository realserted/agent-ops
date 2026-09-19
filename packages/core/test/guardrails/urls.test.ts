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

  it("does not treat an email address as a link", () => {
    expect(extractUrls("Reach me at ops@example.test")).toEqual([]);
  });
});

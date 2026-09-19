import { describe, expect, it } from "vitest";
import { MAX_ERROR_BODY, redactSecrets, REDACTED, safeBody, truncate } from "../src/redact";

describe("redactSecrets", () => {
  it.each([
    ["an Anthropic key", `sk-ant-${"a".repeat(32)}`],
    ["an OpenAI key", `sk-${"b".repeat(40)}`],
    ["a Google key", `AIza${"C".repeat(35)}`],
    ["an AWS access key", `AKIA${"D".repeat(16)}`],
    ["a GitHub token", `ghp_${"e".repeat(36)}`],
    ["a Slack token", "xoxb-1234567890-abcdefghij"],
    ["a bearer token", `Bearer ${"f".repeat(30)}`],
    ["a private key header", "-----BEGIN RSA PRIVATE KEY-----"],
  ])("removes %s", (_label, secret) => {
    const redacted = redactSecrets(`upstream said: ${secret} is invalid`);

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain(REDACTED);
  });

  it("removes every occurrence, not just the first", () => {
    const key = `sk-ant-${"z".repeat(24)}`;
    const redacted = redactSecrets(`${key} and again ${key}`);

    expect(redacted).not.toContain(key);
    expect(redacted).toBe(`${REDACTED} and again ${REDACTED}`);
  });

  it("leaves ordinary error text untouched", () => {
    const body = '{"error":{"message":"model not found","type":"invalid_request_error"}}';

    expect(redactSecrets(body)).toBe(body);
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("short")).toBe("short");
  });

  it("caps at the documented limit and says how much was dropped", () => {
    const long = "x".repeat(MAX_ERROR_BODY + 500);
    const result = truncate(long);

    expect(result.startsWith("x".repeat(MAX_ERROR_BODY))).toBe(true);
    expect(result).toContain("[truncated 500 chars]");
    expect(result.length).toBeLessThan(long.length);
  });

  it("does not truncate at exactly the limit", () => {
    const exact = "y".repeat(MAX_ERROR_BODY);

    expect(truncate(exact)).toBe(exact);
  });

  it("honours a custom limit", () => {
    expect(truncate("abcdef", 3)).toBe("abc... [truncated 3 chars]");
  });
});

describe("safeBody", () => {
  it("truncates and redacts together", () => {
    const key = `sk-ant-${"q".repeat(24)}`;
    const body = `${key} ${"x".repeat(MAX_ERROR_BODY)}`;

    const result = safeBody(body);

    expect(result).not.toContain(key);
    expect(result).toContain(REDACTED);
    expect(result).toContain("[truncated");
  });
});

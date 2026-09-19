import { describe, expect, it } from "vitest";
import { detectSecrets } from "../../src/guardrails/secrets";

describe("detectSecrets", () => {
  it.each([
    ["-----BEGIN RSA PRIVATE KEY-----", "private_key_header"],
    ["-----BEGIN PRIVATE KEY-----", "private_key_header"],
    [`sk-ant-${"a".repeat(24)}`, "anthropic_key"],
    [`sk-${"b".repeat(40)}`, "openai_key"],
    [`AIza${"C".repeat(35)}`, "google_key"],
    [`AKIA${"D".repeat(16)}`, "aws_access_key"],
    [`ghp_${"e".repeat(36)}`, "github_token"],
    ["xoxb-1234567890-abcdefghij", "slack_token"],
    [`Bearer ${"f".repeat(30)}`, "bearer_token"],
  ])("flags %j as %s", (text, expected) => {
    expect(detectSecrets(text)).toContain(expected);
  });

  it("finds a secret embedded in a longer reply", () => {
    const draft = `Hi Maria,\n\nHere is the key you asked for: sk-ant-${"z".repeat(30)}\n\nBest,\nOps`;

    expect(detectSecrets(draft)).toContain("anthropic_key");
  });

  it("returns an empty array for an ordinary reply", () => {
    const draft =
      "Hi Maria, thanks for your interest. Happy to set up a call next week - " +
      "would Tuesday at 10am work? Best, Ops";

    expect(detectSecrets(draft)).toEqual([]);
  });

  it("does not flag ordinary words that merely start with sk-", () => {
    expect(detectSecrets("sk-8 is our internal ticket prefix")).toEqual([]);
  });
});

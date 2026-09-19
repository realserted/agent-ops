import { describe, expect, it } from "vitest";
import { DEFAULT_TASK, SYSTEM_PROMPT } from "../src/config";

describe("SYSTEM_PROMPT", () => {
  it.each(["lead", "invoice", "support_ticket", "other"])("names the %s classification", (kind) => {
    expect(SYSTEM_PROMPT).toContain(kind);
  });

  it("names every tool the agent is expected to call", () => {
    expect(SYSTEM_PROMPT).toContain("create_record");
    expect(SYSTEM_PROMPT).toContain("flag_for_review");
  });

  it("instructs the model not to invent facts", () => {
    expect(SYSTEM_PROMPT).toMatch(/Only use facts present in the email/);
    expect(SYSTEM_PROMPT).toMatch(/Never invent amounts, dates, or names/);
  });

  it("tells the model to flag rather than act on suspicious mail", () => {
    expect(SYSTEM_PROMPT).toMatch(/phishing, spam, or ambiguous/);
  });
});

describe("DEFAULT_TASK", () => {
  it("is a non-empty instruction", () => {
    expect(DEFAULT_TASK.trim().length).toBeGreaterThan(0);
  });
});

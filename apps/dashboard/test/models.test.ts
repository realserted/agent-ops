import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, findModel, MODELS } from "../src/lib/models";
import { PRICES } from "@agent-ops/tracing";

describe("MODELS", () => {
  it("offers at least one model per provider, so switching is possible", () => {
    const providers = new Set(MODELS.map((m) => m.provider));

    expect(providers).toContain("anthropic");
    expect(providers).toContain("gemini");
  });

  it("uses unique ids", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A run whose cost shows "unpriced" is a worse experience than one that does
  // not appear in the picker at all.
  it("only offers models the cost table can price", () => {
    for (const model of MODELS) {
      expect(PRICES[model.id], `${model.id} has no published price`).toBeDefined();
    }
  });

  it("defaults to a model that exists", () => {
    expect(findModel(DEFAULT_MODEL_ID)).toBeDefined();
  });
});

describe("findModel", () => {
  it("resolves a known id to its provider", () => {
    expect(findModel("claude-haiku-4-5")).toMatchObject({ provider: "anthropic" });
    expect(findModel("gemini-2.5-flash")).toMatchObject({ provider: "gemini" });
  });

  // The API route rejects on this, so an id the operator never chose cannot
  // reach the provider factory.
  it.each(["", "gpt-4", "claude-haiku-4-5 ", "../../etc/passwd"])("rejects %j", (id) => {
    expect(findModel(id)).toBeUndefined();
  });

  // The daily cap is the one that actually stops you: a triage run uses
  // several requests, so twenty a day is two or three runs.
  it("names both free-tier quotas, daily first", () => {
    const note = findModel("gemini-2.5-flash")?.note ?? "";

    expect(note).toContain("20 requests/day");
    expect(note).toContain("5/minute");
  });
});

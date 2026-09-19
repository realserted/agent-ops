import { describe, expect, it } from "vitest";
import { createProvider } from "../src/factory";

describe("createProvider", () => {
  it("defaults to Gemini when LLM_PROVIDER is unset", () => {
    const provider = createProvider({ GEMINI_API_KEY: "g-key" });

    expect(provider.name).toBe("gemini");
    expect(provider.model).toBe("gemini-2.5-flash");
  });

  it("honours GEMINI_MODEL and trims surrounding whitespace", () => {
    const provider = createProvider({ GEMINI_API_KEY: "g-key", GEMINI_MODEL: "  gemini-3-pro  " });

    expect(provider.model).toBe("gemini-3-pro");
  });

  it("builds the Anthropic provider with its default model", () => {
    const provider = createProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a-key" });

    expect(provider.name).toBe("anthropic");
    expect(provider.model).toBe("claude-haiku-4-5");
  });

  it("honours ANTHROPIC_MODEL", () => {
    const provider = createProvider({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "a-key",
      ANTHROPIC_MODEL: "claude-sonnet-5",
    });

    expect(provider.model).toBe("claude-sonnet-5");
  });

  it.each([
    ["gemini", {}, "GEMINI_API_KEY"],
    ["anthropic", { LLM_PROVIDER: "anthropic" }, "ANTHROPIC_API_KEY"],
  ])("names the missing key for %s without echoing any value", (_provider, env, key) => {
    expect(() => createProvider(env)).toThrow(new RegExp(`Missing ${key}`));
  });

  it("treats a blank key as missing", () => {
    expect(() => createProvider({ GEMINI_API_KEY: "   " })).toThrow(/Missing GEMINI_API_KEY/);
  });

  it("never includes the key's value in the error message", () => {
    const secret = "super-secret-value";
    try {
      createProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "", ANTHROPIC_MODEL: secret });
      expect.unreachable("expected createProvider to throw");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects an unknown provider name and lists the valid ones", () => {
    expect(() => createProvider({ LLM_PROVIDER: "openai" })).toThrow(
      /Unknown LLM_PROVIDER "openai".*gemini.*anthropic/,
    );
  });
});

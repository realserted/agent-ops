import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, parseEnv, PROVIDER_NAMES } from "../src/env";

describe("parseEnv", () => {
  it("defaults to Gemini with its default model", () => {
    expect(parseEnv({ GEMINI_API_KEY: "g-key" })).toEqual({
      provider: "gemini",
      apiKey: "g-key",
      model: DEFAULT_MODELS.gemini,
    });
  });

  it("selects Anthropic and its default model", () => {
    expect(parseEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a-key" })).toMatchObject({
      provider: "anthropic",
      model: DEFAULT_MODELS.anthropic,
    });
  });

  it("trims whitespace from every value", () => {
    expect(parseEnv({ LLM_PROVIDER: "  gemini ", GEMINI_API_KEY: " g-key ", GEMINI_MODEL: " m " })).toEqual({
      provider: "gemini",
      apiKey: "g-key",
      model: "m",
    });
  });

  it("ignores the other provider's variables", () => {
    const settings = parseEnv({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "a-key",
      GEMINI_MODEL: "gemini-should-be-ignored",
    });

    expect(settings.model).toBe(DEFAULT_MODELS.anthropic);
  });

  it.each([
    ["gemini", {}, "GEMINI_API_KEY"],
    ["anthropic", { LLM_PROVIDER: "anthropic" }, "ANTHROPIC_API_KEY"],
  ])("names the missing key for %s and points at .env.example", (_p, env, key) => {
    expect(() => parseEnv(env)).toThrow(new RegExp(`Missing ${key}.*\\.env\\.example`));
  });

  it.each([["an empty key", ""], ["a whitespace key", "   "]])("treats %s as missing", (_label, value) => {
    expect(() => parseEnv({ GEMINI_API_KEY: value })).toThrow(/Missing GEMINI_API_KEY/);
  });

  it("rejects an unknown provider and lists the valid ones", () => {
    expect(() => parseEnv({ LLM_PROVIDER: "openai" })).toThrow(
      new RegExp(`Unknown LLM_PROVIDER "openai".*${PROVIDER_NAMES.join(", ")}`),
    );
  });

  it("never puts a credential value into an error message", () => {
    const secret = "sk-ant-super-secret-value-that-must-not-leak";

    for (const env of [
      { LLM_PROVIDER: "openai", ANTHROPIC_API_KEY: secret, GEMINI_API_KEY: secret },
      { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: secret },
    ]) {
      try {
        parseEnv(env);
        expect.unreachable("expected parseEnv to throw");
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    }
  });

  it("reports variable names, not values, when a variable is not a string", () => {
    const settings = () => parseEnv({ GEMINI_API_KEY: 42 as unknown as string });

    expect(settings).toThrow(/GEMINI_API_KEY/);
    expect(settings).toThrow(/Invalid environment variables/);
  });
});

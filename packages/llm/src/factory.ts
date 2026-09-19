import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import type { LLMProvider } from "./types";

const DEFAULT_MODELS = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-4-5",
} as const;

type ProviderName = keyof typeof DEFAULT_MODELS;

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}. Add it to your .env file (see .env.example).`);
  return value;
}

/** Builds the configured provider from environment variables. */
export function createProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const provider = (env.LLM_PROVIDER?.trim() || "gemini") as ProviderName;

  switch (provider) {
    case "gemini":
      return new GeminiProvider(requireEnv(env, "GEMINI_API_KEY"), env.GEMINI_MODEL?.trim() || DEFAULT_MODELS.gemini);
    case "anthropic":
      return new AnthropicProvider(
        requireEnv(env, "ANTHROPIC_API_KEY"),
        env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODELS.anthropic,
      );
    default:
      throw new Error(`Unknown LLM_PROVIDER "${String(provider)}". Use one of: ${Object.keys(DEFAULT_MODELS).join(", ")}.`);
  }
}

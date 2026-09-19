import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { parseEnv } from "./env";
import type { LLMProvider } from "./types";

/** Builds the configured provider from validated environment variables. */
export function createProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const { provider, apiKey, model } = parseEnv(env);

  switch (provider) {
    case "gemini":
      return new GeminiProvider(apiKey, model);
    case "anthropic":
      return new AnthropicProvider(apiKey, model);
  }
}

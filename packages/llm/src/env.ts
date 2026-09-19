import { z } from "zod";

export const PROVIDER_NAMES = ["gemini", "anthropic"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-4-5",
};

/** The env var holding each provider's credential. */
const API_KEY_VAR: Record<ProviderName, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const MODEL_VAR: Record<ProviderName, string> = {
  gemini: "GEMINI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
};

/**
 * Blank and whitespace-only values are absent, not empty.
 *
 * Non-strings are passed through rather than coerced away, so a malformed
 * value fails validation instead of silently masquerading as unset.
 */
const optional = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || undefined : value),
  z.string().optional(),
);

const EnvSchema = z.object({
  LLM_PROVIDER: optional,
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: optional,
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: optional,
});

export interface ProviderSettings {
  provider: ProviderName;
  apiKey: string;
  model: string;
}

const isProviderName = (value: string): value is ProviderName =>
  (PROVIDER_NAMES as readonly string[]).includes(value);

/**
 * Validates the environment into provider settings.
 *
 * Every message names the variable at fault and never includes its value:
 * these errors reach terminals, CI logs and issue reports, and a credential
 * echoed into one of those is disclosed even if the run then fails.
 */
export function parseEnv(env: NodeJS.ProcessEnv = process.env): ProviderSettings {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Reached only if a variable is a non-string; report the names, not the data.
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${names}.`);
  }

  const requested = parsed.data.LLM_PROVIDER ?? "gemini";
  if (!isProviderName(requested)) {
    throw new Error(
      `Unknown LLM_PROVIDER "${requested}". Use one of: ${PROVIDER_NAMES.join(", ")}.`,
    );
  }

  const keyVar = API_KEY_VAR[requested];
  const apiKey = parsed.data[keyVar as keyof typeof parsed.data];
  if (!apiKey) {
    throw new Error(`Missing ${keyVar}. Add it to your .env file (see .env.example).`);
  }

  const modelVar = MODEL_VAR[requested];
  const model = parsed.data[modelVar as keyof typeof parsed.data] ?? DEFAULT_MODELS[requested];

  return { provider: requested, apiKey, model };
}

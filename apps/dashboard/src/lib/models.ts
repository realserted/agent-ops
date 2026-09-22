export interface ModelChoice {
  id: string;
  provider: "anthropic" | "gemini";
  label: string;
  /** Shown in the picker when a model has an operational catch worth knowing. */
  note?: string;
}

/**
 * The models a run may be started with.
 *
 * One list drives both the picker and the validation on the API route, so the
 * UI cannot offer something the server rejects, and the server cannot be talked
 * into a model the operator never chose.
 */
export const MODELS: ModelChoice[] = [
  { id: "claude-haiku-4-5", provider: "anthropic", label: "Claude Haiku 4.5" },
  { id: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5" },
  {
    id: "gemini-2.5-flash",
    provider: "gemini",
    label: "Gemini 2.5 Flash",
    // Two separate free-tier quotas, and the daily one is the one that
    // actually bites: a triage run can take nine requests, so twenty a day is
    // two or three runs. Better to say so than to let it fail as a raw 429.
    note: "Free tier: 20 requests/day and 5/minute. A triage run uses up to 9, so expect 2-3 runs a day.",
  },
];

export const DEFAULT_MODEL_ID = MODELS[0]!.id;

export function findModel(id: string): ModelChoice | undefined {
  return MODELS.find((model) => model.id === id);
}

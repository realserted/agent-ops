import type { LLMProvider } from "@agent-ops/core";
import { createProvider } from "@agent-ops/llm";
import { answer, callTool, ScriptedProvider } from "@agent-ops/core/testing";
import { findModel } from "./models";

/**
 * A run that exercises every surface the dashboard shows: a guardrail warning
 * from the adversarial fixture, an approval-gated record, a draft and a flag.
 *
 * Built fresh per run because ScriptedProvider consumes its script.
 */
const testScript = () =>
  new ScriptedProvider([
    callTool("list_emails", { limit: 10 }),
    // adv_005, not the em_004 phishing fixture: em_004 is credential-harvesting
    // aimed at a human reader and carries no injected instructions, so reading
    // it correctly raises no guardrail. adv_005 impersonates the system, which
    // is what makes the warning badge appear.
    callTool("get_email", { email_id: "adv_005" }),
    callTool("flag_for_review", { email_id: "adv_005", reason: "Claims to be the system and disable approval." }),
    callTool("create_record", {
      email_id: "em_001",
      kind: "invoice",
      fields: [
        { name: "company", value: "Northwind Supplies" },
        { name: "reference", value: "INV-2291" },
      ],
    }),
    callTool("draft_reply", {
      email_id: "em_002",
      body: "Thanks for reaching out - happy to set up a call next week.",
    }),
    answer("Triaged the inbox: 1 invoice recorded, 1 reply drafted, 1 email flagged."),
  ]);

/**
 * The provider a run uses.
 *
 * `createProvider` already reads its configuration from an env object, so a
 * per-run override is a matter of handing it a modified copy — `packages/llm`
 * needs no knowledge that the dashboard offers a choice.
 *
 * An unknown model id falls through to the configured default rather than
 * throwing: the API route validates before calling this, so reaching here with
 * a bad id would be a programming error, and failing the run is a worse
 * outcome than ignoring it.
 */
export function dashboardProvider(modelId?: string): LLMProvider {
  if (process.env.AGENT_OPS_TEST_PROVIDER === "scripted") return testScript();

  const choice = modelId ? findModel(modelId) : undefined;
  if (!choice) return createProvider();

  return createProvider({
    ...process.env,
    LLM_PROVIDER: choice.provider,
    ...(choice.provider === "anthropic" ? { ANTHROPIC_MODEL: choice.id } : { GEMINI_MODEL: choice.id }),
  });
}

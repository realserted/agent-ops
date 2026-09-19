import type { LLMProvider } from "@agent-ops/core";
import { createProvider } from "@agent-ops/llm";
import { answer, callTool, ScriptedProvider } from "@agent-ops/core/testing";

/**
 * A run that exercises every surface the dashboard shows: a guardrail warning
 * from the phishing fixture, an approval-gated call, and a final answer with
 * token counts.
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
      fields: [{ name: "company", value: "Northwind Supplies" }],
    }),
    answer("Triaged the inbox: 1 invoice recorded, 1 email flagged."),
  ]);

/**
 * The provider the dashboard runs against.
 *
 * End-to-end tests set AGENT_OPS_TEST_PROVIDER=scripted so they never call a
 * real API: the flows under test are the queue and the viewer, and a live model
 * would make them slow, costly and non-deterministic.
 */
export function dashboardProvider(): LLMProvider {
  return process.env.AGENT_OPS_TEST_PROVIDER === "scripted" ? testScript() : createProvider();
}

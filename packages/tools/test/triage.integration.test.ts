import { describe, expect, it } from "vitest";
import { Agent, ToolRegistry } from "@agent-ops/core";
import { answer, callTool, ScriptedProvider } from "@agent-ops/core/testing";
import { createOperationsTools } from "../src/operations-tools";
import { FixtureInbox } from "../src/adapters/fixture-inbox";
import { InMemoryOperationsStore } from "../src/adapters/memory-store";

/**
 * Drives the real tools with a scripted model, mimicking a full triage pass:
 * list the inbox, read an invoice and a lead, record them, draft one reply and
 * flag a phishing attempt.
 */
const buildRun = async (approveAll: boolean) => {
  const store = new InMemoryOperationsStore();
  const inbox = await FixtureInbox.fromFile();
  const agent = new Agent({
    llm: new ScriptedProvider([
      callTool("list_emails", { limit: 10 }),
      callTool("get_email", { email_id: "em_001" }),
      callTool("create_record", {
        email_id: "em_001",
        kind: "invoice",
        fields: [
          { name: "company", value: "Northwind Supplies" },
          { name: "reference", value: "INV-2291" },
        ],
      }),
      callTool("get_email", { email_id: "em_002" }),
      callTool("create_record", {
        email_id: "em_002",
        kind: "lead",
        fields: [{ name: "company", value: "Brightpath" }],
      }),
      callTool("draft_reply", { email_id: "em_002", body: "Thanks for your interest - happy to set up a call." }),
      callTool("flag_for_review", { email_id: "em_004", reason: "Sender domain imitates a payment provider." }),
      answer("Triaged 5 emails: 1 invoice, 1 lead, 1 flagged."),
    ]),
    tools: new ToolRegistry(createOperationsTools({ inbox, store })),
    systemPrompt: "test",
    maxSteps: 15,
    approve: async () => approveAll,
  });

  return { store, result: await agent.run("Triage the inbox.") };
};

describe("triage run", () => {
  it("completes and writes records, a draft and a flag to the store", async () => {
    const { store, result } = await buildRun(true);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Triaged 5 emails: 1 invoice, 1 lead, 1 flagged.");
    expect(result.steps).toBe(8);

    expect(store.records.map((r) => [r.kind, r.emailId])).toEqual([
      ["invoice", "em_001"],
      ["lead", "em_002"],
    ]);
    expect(store.records[0]?.data).toEqual({ company: "Northwind Supplies", reference: "INV-2291" });

    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0]).toMatchObject({ emailId: "em_002" });

    expect(store.flags).toHaveLength(1);
    expect(store.flags[0]).toMatchObject({ emailId: "em_004" });
  });

  it("reports every tool call as a non-error result", async () => {
    const { result } = await buildRun(true);
    const results = result.messages.flatMap((m) => (m.role === "tool" ? m.results : []));

    expect(results).toHaveLength(7);
    expect(results.every((r) => !r.isError)).toBe(true);
  });

  it("accumulates usage across all eight steps", async () => {
    const { result } = await buildRun(true);

    expect(result.usage).toEqual({ inputTokens: 80, outputTokens: 40 });
  });

  it("writes no records when the approver denies, but still drafts and flags", async () => {
    const { store, result } = await buildRun(false);

    expect(result.status).toBe("completed");
    expect(store.records).toHaveLength(0);

    // draft_reply and flag_for_review are not approval-gated today.
    expect(store.drafts).toHaveLength(1);
    expect(store.flags).toHaveLength(1);

    const denied = result.messages
      .flatMap((m) => (m.role === "tool" ? m.results : []))
      .filter((r) => r.isError);
    expect(denied).toHaveLength(2);
    expect(JSON.stringify(denied[0]?.output)).toMatch(/did not approve/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { Tool } from "@agent-ops/core";
import { createOperationsTools } from "../src/operations-tools";
import { FixtureInbox } from "../src/adapters/fixture-inbox";
import { InMemoryOperationsStore } from "../src/adapters/memory-store";
import type { Email } from "../src/types";

const email = (id: string, receivedAt: string, body = `body of ${id}`): Email => ({
  id,
  from: `${id}@example.test`,
  subject: `Subject ${id}`,
  body,
  receivedAt,
});

// Deliberately unsorted so list_emails has something to order.
const EMAILS = [
  email("em_002", "2026-09-18T14:40:00Z"),
  email("em_004", "2026-09-19T03:30:00Z"),
  email("em_001", "2026-09-18T08:12:00Z"),
  email("em_003", "2026-09-19T01:05:00Z"),
];

const context = { runId: "run_test" };

let store: InMemoryOperationsStore;
let tools: Map<string, Tool>;

const run = (name: string, args: unknown) => {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.execute(tool.schema.parse(args), context);
};

beforeEach(() => {
  store = new InMemoryOperationsStore();
  tools = new Map(
    createOperationsTools({ inbox: new FixtureInbox(EMAILS), store }).map((tool) => [tool.name, tool]),
  );
});

describe("list_emails", () => {
  it("returns newest first", async () => {
    const { emails } = (await run("list_emails", {})) as { emails: { id: string }[] };

    expect(emails.map((e) => e.id)).toEqual(["em_004", "em_003", "em_002", "em_001"]);
  });

  it("respects the limit", async () => {
    const { emails } = (await run("list_emails", { limit: 2 })) as { emails: { id: string }[] };

    expect(emails.map((e) => e.id)).toEqual(["em_004", "em_003"]);
  });

  it("defaults to 10 when no limit is given", async () => {
    const { emails } = (await run("list_emails", {})) as { emails: unknown[] };

    expect(emails).toHaveLength(4);
  });

  it("never returns bodies", async () => {
    const { emails } = (await run("list_emails", {})) as { emails: Record<string, unknown>[] };

    for (const summary of emails) expect(summary).not.toHaveProperty("body");
    expect(emails[0]).toMatchObject({ id: "em_004", from: "em_004@example.test" });
  });
});

describe("get_email", () => {
  it("returns the full email including the body", async () => {
    await expect(run("get_email", { email_id: "em_001" })).resolves.toMatchObject({
      id: "em_001",
      body: "body of em_001",
    });
  });
});

describe("create_record", () => {
  it("requires human approval", () => {
    expect(tools.get("create_record")?.requiresApproval).toBe(true);
  });

  it("converts the fields array into a data object", async () => {
    const record = await run("create_record", {
      email_id: "em_001",
      kind: "invoice",
      fields: [
        { name: "company", value: "Northwind" },
        { name: "amount", value: "1200.00" },
      ],
    });

    expect(record).toMatchObject({
      emailId: "em_001",
      kind: "invoice",
      data: { company: "Northwind", amount: "1200.00" },
    });
    expect(store.records).toHaveLength(1);
  });

  it("rejects a kind outside the allowed set", () => {
    const tool = tools.get("create_record");
    const parsed = tool?.schema.safeParse({
      email_id: "em_001",
      kind: "refund",
      fields: [{ name: "a", value: "b" }],
    });

    expect(parsed?.success).toBe(false);
  });
});

describe("draft_reply", () => {
  it("saves a draft against the email", async () => {
    await run("draft_reply", { email_id: "em_002", body: "Thanks for reaching out." });

    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0]).toMatchObject({ emailId: "em_002", body: "Thanks for reaching out." });
  });
});

describe("flag_for_review", () => {
  it("records the reason", async () => {
    await run("flag_for_review", { email_id: "em_004", reason: "Possible phishing." });

    expect(store.flags).toHaveLength(1);
    expect(store.flags[0]).toMatchObject({ emailId: "em_004", reason: "Possible phishing." });
  });
});

describe("email-scoped tools", () => {
  it.each([
    ["get_email", {}],
    ["create_record", { kind: "lead", fields: [{ name: "a", value: "b" }] }],
    ["draft_reply", { body: "hello" }],
    ["flag_for_review", { reason: "suspicious" }],
  ])("%s rejects an unknown email_id and names the recovery step", async (name, extra) => {
    await expect(run(name, { email_id: "em_missing", ...extra })).rejects.toThrow(
      /No email with id "em_missing".*list_emails/,
    );
  });

  it("writes nothing to the store when the email does not exist", async () => {
    await expect(run("draft_reply", { email_id: "em_missing", body: "hi" })).rejects.toThrow();

    expect(store.drafts).toHaveLength(0);
  });
});

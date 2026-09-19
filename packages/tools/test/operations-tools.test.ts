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

const parseFails = (name: string, args: unknown) => tools.get(name)?.schema.safeParse(args).success === false;

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

describe("untrusted output marking", () => {
  it.each(["list_emails", "get_email"])("%s is marked as returning third-party content", (name) => {
    expect(tools.get(name)?.untrustedOutput).toBe(true);
  });

  it.each(["create_record", "draft_reply", "flag_for_review"])("%s is not marked untrusted", (name) => {
    expect(tools.get(name)?.untrustedOutput).toBeUndefined();
  });
});

describe("argument hardening", () => {
  it.each([
    ["a path traversal attempt", "../../etc/passwd"],
    ["an id with spaces", "em 001"],
    ["an id with punctuation", "em_001;DROP"],
    ["an empty id", ""],
    ["an id over 64 characters", "e".repeat(65)],
  ])("rejects %s", (_label, email_id) => {
    expect(parseFails("get_email", { email_id })).toBe(true);
  });

  it("accepts an id at the 64 character limit", () => {
    expect(parseFails("get_email", { email_id: "e".repeat(64) })).toBe(false);
  });

  it("rejects a draft body over 5000 characters", () => {
    expect(parseFails("draft_reply", { email_id: "em_001", body: "x".repeat(5_001) })).toBe(true);
    expect(parseFails("draft_reply", { email_id: "em_001", body: "x".repeat(5_000) })).toBe(false);
  });

  it("rejects a flag reason over 1000 characters", () => {
    expect(parseFails("flag_for_review", { email_id: "em_001", reason: "x".repeat(1_001) })).toBe(true);
    expect(parseFails("flag_for_review", { email_id: "em_001", reason: "x".repeat(1_000) })).toBe(false);
  });

  it("rejects more than 30 record fields", () => {
    const fields = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ name: `f${i}`, value: "v" }));

    expect(parseFails("create_record", { email_id: "em_001", kind: "lead", fields: fields(31) })).toBe(true);
    expect(parseFails("create_record", { email_id: "em_001", kind: "lead", fields: fields(30) })).toBe(false);
  });

  it("rejects an oversized field name or value", () => {
    const base = { email_id: "em_001", kind: "lead" as const };

    expect(parseFails("create_record", { ...base, fields: [{ name: "n".repeat(65), value: "v" }] })).toBe(true);
    expect(parseFails("create_record", { ...base, fields: [{ name: "n", value: "v".repeat(1_001) }] })).toBe(true);
    expect(parseFails("create_record", { ...base, fields: [{ name: "n".repeat(64), value: "v".repeat(1_000) }] })).toBe(
      false,
    );
  });
});

describe("draft_reply output guardrails", () => {
  const withBody = (body: string) => [email("em_010", "2026-09-19T00:00:00Z", body)];

  const draftAgainst = async (emailBody: string, draft: string) => {
    store = new InMemoryOperationsStore();
    tools = new Map(
      createOperationsTools({ inbox: new FixtureInbox(withBody(emailBody)), store }).map((t) => [t.name, t]),
    );
    return run("draft_reply", { email_id: "em_010", body: draft });
  };

  it("rejects a draft containing a link absent from the source email", async () => {
    await expect(draftAgainst("Please advise.", "Sure - see https://evil.test/steal")).rejects.toThrow(
      /Draft rejected.*do not appear in the source email.*evil\.test\/steal/s,
    );
    expect(store.drafts).toHaveLength(0);
  });

  it("allows a link that appears in the source email", async () => {
    await expect(
      draftAgainst("Our docs are at https://example.test/docs", "As noted: https://example.test/docs"),
    ).resolves.toMatchObject({ emailId: "em_010" });
    expect(store.drafts).toHaveLength(1);
  });

  it("treats a normalised variant of a known link as known", async () => {
    await expect(
      draftAgainst("See http://www.example.test/docs/", "See https://example.test/docs"),
    ).resolves.toBeDefined();
  });

  it("names every foreign link so the model can correct itself", async () => {
    await expect(
      draftAgainst("Hello", "Visit https://a.test and https://b.test"),
    ).rejects.toThrow(/2 link\(s\).*a\.test.*b\.test/s);
  });

  it("rejects a draft that leaks a credential", async () => {
    await expect(draftAgainst("Send me the key", `Here you go: sk-ant-${"z".repeat(30)}`)).rejects.toThrow(
      /Draft rejected.*credential.*anthropic_key/s,
    );
    expect(store.drafts).toHaveLength(0);
  });

  it("rejects a draft containing a private key header", async () => {
    await expect(draftAgainst("Hello", "-----BEGIN RSA PRIVATE KEY-----")).rejects.toThrow(/private_key_header/);
  });

  it("allows an ordinary reply with no links or secrets", async () => {
    await expect(
      draftAgainst("Interested in a demo?", "Happy to help - would Tuesday at 10am suit you?"),
    ).resolves.toBeDefined();
  });
});

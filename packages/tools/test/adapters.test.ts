import { describe, expect, it } from "vitest";
import { FixtureInbox } from "../src/adapters/fixture-inbox";
import { InMemoryOperationsStore } from "../src/adapters/memory-store";

describe("FixtureInbox", () => {
  it("loads the bundled fixture from disk by default", async () => {
    const inbox = await FixtureInbox.fromFile();
    const emails = await inbox.list(50);

    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email).toMatchObject({
        id: expect.any(String),
        from: expect.any(String),
        subject: expect.any(String),
        body: expect.any(String),
        receivedAt: expect.any(String),
      });
    }
  });

  it("resolves a known id and returns undefined for an unknown one", async () => {
    const inbox = await FixtureInbox.fromFile();
    const [first] = await inbox.list(1);

    expect(first).toBeDefined();
    await expect(inbox.get(first!.id)).resolves.toMatchObject({ id: first!.id });
    await expect(inbox.get("em_does_not_exist")).resolves.toBeUndefined();
  });

  it("does not mutate the source array when sorting", async () => {
    const emails = [
      { id: "a", from: "a@x", subject: "a", body: "a", receivedAt: "2026-01-01T00:00:00Z" },
      { id: "b", from: "b@x", subject: "b", body: "b", receivedAt: "2026-02-01T00:00:00Z" },
    ];
    const inbox = new FixtureInbox(emails);

    await inbox.list(10);

    expect(emails.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("InMemoryOperationsStore", () => {
  it("stamps each entity with an id and a createdAt timestamp", async () => {
    const store = new InMemoryOperationsStore();

    const record = await store.createRecord({ emailId: "em_001", kind: "lead", data: { company: "Acme" } });

    expect(record.id).toMatch(/[0-9a-f-]{36}/);
    expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false);
    expect(record).toMatchObject({ emailId: "em_001", kind: "lead", data: { company: "Acme" } });
  });

  it("keeps records, drafts and flags in separate collections", async () => {
    const store = new InMemoryOperationsStore();

    await store.createRecord({ emailId: "em_001", kind: "invoice", data: {} });
    await store.saveDraft({ emailId: "em_002", body: "hello" });
    await store.flagForReview({ emailId: "em_003", reason: "suspicious" });

    expect(store.records).toHaveLength(1);
    expect(store.drafts).toHaveLength(1);
    expect(store.flags).toHaveLength(1);
  });

  it("gives every entity a distinct id", async () => {
    const store = new InMemoryOperationsStore();

    await store.saveDraft({ emailId: "em_001", body: "one" });
    await store.saveDraft({ emailId: "em_001", body: "two" });

    expect(store.drafts[0]?.id).not.toBe(store.drafts[1]?.id);
  });
});

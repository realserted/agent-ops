import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TABLES, SupabaseOperationsStore } from "../src/adapters/supabase-store";

const OPTIONS = { url: "https://proj.supabase.test", apiKey: "anon-key-123" };

const rows = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 201 });

const store = (fetchMock: ReturnType<typeof vi.fn>, overrides = {}) => {
  vi.stubGlobal("fetch", fetchMock);
  return new SupabaseOperationsStore({ ...OPTIONS, ...overrides });
};

const sent = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return { url: String(url), init, body: JSON.parse(init.body) };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SupabaseOperationsStore", () => {
  it("posts to the configured table with both auth headers", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(rows([{ id: "1", email_id: "em_001", created_at: "t", kind: "invoice", data: {} }]));

    await store(fetchMock).createRecord({ emailId: "em_001", kind: "invoice", data: {} });

    const { url, init } = sent(fetchMock);
    expect(url).toBe(`https://proj.supabase.test/rest/v1/${DEFAULT_TABLES.records}`);
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("anon-key-123");
    expect(init.headers.authorization).toBe("Bearer anon-key-123");
  });

  // Without this header PostgREST returns 201 and an empty body, and the
  // caller never learns the generated id.
  it("asks PostgREST to return the inserted row", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(rows([{ id: "1", email_id: "e", created_at: "t", kind: "lead", data: {} }]));

    await store(fetchMock).createRecord({ emailId: "e", kind: "lead", data: {} });

    expect(sent(fetchMock).init.headers.prefer).toBe("return=representation");
  });

  it("maps camelCase fields onto snake_case columns", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(rows([{ id: "1", email_id: "em_002", created_at: "t", body: "hi" }]));

    await store(fetchMock).saveDraft({ emailId: "em_002", body: "hi" });

    expect(sent(fetchMock).body).toEqual({ email_id: "em_002", body: "hi" });
  });

  // Letting Postgres own these means two processes writing concurrently cannot
  // collide on an id or disagree about ordering.
  it("does not send an id or timestamp, leaving both to Postgres", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(rows([{ id: "gen", email_id: "e", created_at: "gen-time", reason: "r" }]));

    await store(fetchMock).flagForReview({ emailId: "e", reason: "r" });

    const { body } = sent(fetchMock);
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("created_at");
  });

  it("maps the returned row back to the domain shape", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        rows([{ id: "rec-1", email_id: "em_001", created_at: "2026-09-19T00:00:00Z", kind: "invoice", data: { a: "b" } }]),
      );

    await expect(store(fetchMock).createRecord({ emailId: "em_001", kind: "invoice", data: { a: "b" } })).resolves.toEqual({
      id: "rec-1",
      emailId: "em_001",
      createdAt: "2026-09-19T00:00:00Z",
      kind: "invoice",
      data: { a: "b" },
    });
  });

  it.each([
    ["drafts", "saveDraft", { emailId: "e", body: "b" }],
    ["flags", "flagForReview", { emailId: "e", reason: "r" }],
  ])("writes %s to its own table", async (key, method, input) => {
    const fetchMock = vi
      .fn()
      .mockImplementation(rows([{ id: "1", email_id: "e", created_at: "t", body: "b", reason: "r" }]));
    const target = store(fetchMock);

    await (target[method as "saveDraft" | "flagForReview"] as (i: never) => Promise<unknown>)(input as never);

    expect(sent(fetchMock).url).toContain(DEFAULT_TABLES[key as keyof typeof DEFAULT_TABLES]);
  });

  it("honours overridden table names", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(rows([{ id: "1", email_id: "e", created_at: "t", kind: "lead", data: {} }]));

    await store(fetchMock, { tables: { records: "custom_records" } }).createRecord({
      emailId: "e",
      kind: "lead",
      data: {},
    });

    expect(sent(fetchMock).url).toContain("custom_records");
  });

  it("fails loudly when the insert returns no row", async () => {
    const fetchMock = vi.fn().mockImplementation(rows([]));

    await expect(store(fetchMock).saveDraft({ emailId: "e", body: "b" })).rejects.toThrow(/returned no row/);
  });

  it("surfaces a rejected write, such as a row-level security denial", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response('{"message":"new row violates RLS"}', { status: 401 }));

    await expect(store(fetchMock).saveDraft({ emailId: "e", body: "b" })).rejects.toThrow(/POST failed \(401\)/);
  });
});

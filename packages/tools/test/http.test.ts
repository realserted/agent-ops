import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterHttpError, requestJson } from "../src/adapters/http";

// 204 must be constructed with a null body; a string throws in undici.
const respondWith = (status: number, body: string) =>
  vi.fn().mockImplementation(async () => new Response(body === "" ? null : body, { status }));

const call = (fetchMock: ReturnType<typeof vi.fn>) => {
  vi.stubGlobal("fetch", fetchMock);
  return requestJson<unknown>("https://api.test/v1/thing", {
    method: "POST",
    headers: { apikey: "anon-key" },
    body: { a: 1 },
  });
};

const caught = async (fetchMock: ReturnType<typeof vi.fn>): Promise<AdapterHttpError> => {
  try {
    await call(fetchMock);
    throw new Error("expected requestJson to throw");
  } catch (error) {
    if (!(error instanceof AdapterHttpError)) throw error;
    return error;
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestJson", () => {
  it("returns the parsed body on success", async () => {
    await expect(call(respondWith(200, '{"ok":true}'))).resolves.toEqual({ ok: true });
  });

  it("treats an empty body as a successful write", async () => {
    await expect(call(respondWith(204, ""))).resolves.toBeNull();
  });

  it("carries the status through on failure", async () => {
    const error = await caught(respondWith(401, "unauthorized"));

    expect(error).toMatchObject({ name: "AdapterHttpError", status: 401 });
  });

  // The gap CodeQL surfaced as clear-text logging: this body reaches an
  // AdapterHttpError, whose message the CLI prints. The llm layer already
  // redacted; this one only truncated.
  it("redacts a credential echoed back by the upstream service", async () => {
    const key = `sk-ant-${"a".repeat(32)}`;
    const error = await caught(respondWith(400, `{"error":"bad apikey ${key}"}`));

    expect(error.body).not.toContain(key);
    expect(error.body).toContain("[redacted]");
  });

  it.each([
    ["a bearer token", `Bearer ${"f".repeat(30)}`],
    ["a Google key", `AIza${"C".repeat(35)}`],
    ["a private key header", "-----BEGIN RSA PRIVATE KEY-----"],
  ])("redacts %s", async (_label, secret) => {
    const error = await caught(respondWith(500, `upstream said: ${secret}`));

    expect(error.body).not.toContain(secret);
  });

  it("still truncates a large body", async () => {
    const error = await caught(respondWith(500, "x".repeat(5_000)));

    expect(error.body.length).toBeLessThanOrEqual(1_000);
  });

  it("leaves an ordinary error body readable", async () => {
    const error = await caught(respondWith(404, '{"message":"relation does not exist"}'));

    expect(error.body).toContain("relation does not exist");
  });
});

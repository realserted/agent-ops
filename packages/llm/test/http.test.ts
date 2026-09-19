import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMHttpError, postJson, toJsonObject } from "../src/http";

// Each call must build a fresh Response: a body can only be read once, so a
// shared instance would throw "Body is unusable" on the first retry.
const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
const fail =
  (status: number, body = "upstream said no") =>
  async () =>
    new Response(body, { status });

const post = (fetchMock: ReturnType<typeof vi.fn>, overrides = {}) => {
  vi.stubGlobal("fetch", fetchMock);
  return postJson<{ done: boolean }>("https://example.test/v1", { hello: "world" }, {
    headers: { "x-api-key": "secret" },
    baseDelayMs: 1000,
    ...overrides,
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("postJson", () => {
  it("sends JSON with the caller's headers and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockImplementation(ok({ done: true }));

    await expect(post(fetchMock)).resolves.toEqual({ done: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://example.test/v1");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json", "x-api-key": "secret" });
    expect(JSON.parse(init.body)).toEqual({ hello: "world" });
  });

  it("retries a 429 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementationOnce(fail(429)).mockImplementationOnce(ok({ done: true }));

    const promise = post(fetchMock);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi.fn().mockImplementation(fail(400, "bad request"));

    await expect(post(fetchMock)).rejects.toBeInstanceOf(LLMHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws LLMHttpError carrying status and body after exhausting maxRetries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(fail(503, "unavailable"));

    const promise = post(fetchMock, { maxRetries: 2 }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await promise;

    expect(error).toBeInstanceOf(LLMHttpError);
    expect(error).toMatchObject({ name: "LLMHttpError", status: 503, body: "unavailable" });
    // Initial attempt plus two retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("doubles the delay between retries", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      handler();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const fetchMock = vi.fn().mockImplementation(fail(429));
    await post(fetchMock, { maxRetries: 3 }).catch(() => undefined);

    expect(delays).toEqual([1000, 2000, 4000]);
  });
});

describe("toJsonObject", () => {
  it("passes plain objects through unchanged", () => {
    const value = { a: 1, b: "two" };
    expect(toJsonObject(value)).toBe(value);
  });

  it.each([
    ["a string", "hello", { result: "hello" }],
    ["a number", 42, { result: 42 }],
    ["a boolean", false, { result: false }],
    ["an array", [1, 2], { result: [1, 2] }],
    ["null", null, { result: null }],
    ["undefined", undefined, { result: null }],
  ])("wraps %s", (_label, input, expected) => {
    expect(toJsonObject(input)).toEqual(expected);
  });
});

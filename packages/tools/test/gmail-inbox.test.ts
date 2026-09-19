import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailInbox, toEmail } from "../src/adapters/gmail-inbox";

const b64url = (text: string) =>
  Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "18c2f",
  internalDate: "1789459200000",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "billing@northwind.test" },
      { name: "Subject", value: "Invoice INV-2291" },
    ],
    body: { data: b64url("Please find the invoice attached.") },
  },
  ...overrides,
});

const jsonResponse = (body: unknown) => async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toEmail", () => {
  it("maps headers, body and timestamp", () => {
    expect(toEmail(message())).toEqual({
      id: "18c2f",
      from: "billing@northwind.test",
      subject: "Invoice INV-2291",
      body: "Please find the invoice attached.",
      receivedAt: "2026-09-15T08:00:00.000Z",
    });
  });

  it("matches header names case-insensitively", () => {
    const email = toEmail(
      message({
        payload: {
          mimeType: "text/plain",
          headers: [{ name: "from", value: "a@b.test" }],
          body: { data: b64url("hi") },
        },
      }),
    );

    expect(email.from).toBe("a@b.test");
  });

  it("returns empty strings for missing headers rather than undefined", () => {
    const email = toEmail({ id: "x", payload: { mimeType: "text/plain", body: { data: b64url("hi") } } });

    expect(email.from).toBe("");
    expect(email.subject).toBe("");
  });

  // Gmail's base64url differs from base64 in two characters; getting this wrong
  // corrupts exactly the messages containing those bytes.
  it("decodes base64url, including - and _ substitutions", () => {
    const tricky = "subjects ~ ?? >> ~~ <<";
    const email = toEmail(
      message({ payload: { mimeType: "text/plain", body: { data: b64url(tricky) } } }),
    );

    expect(email.body).toBe(tricky);
  });

  it("prefers the plain-text part of a multipart message", () => {
    const email = toEmail(
      message({
        payload: {
          mimeType: "multipart/alternative",
          headers: [{ name: "From", value: "a@b.test" }],
          parts: [
            { mimeType: "text/html", body: { data: b64url("<p>hidden</p>") } },
            { mimeType: "text/plain", body: { data: b64url("visible text") } },
          ],
        },
      }),
    );

    expect(email.body).toBe("visible text");
    expect(email.body).not.toContain("<p>");
  });

  it("finds a plain part nested deeper in the tree", () => {
    const email = toEmail(
      message({
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64url("deep") } }] },
          ],
        },
      }),
    );

    expect(email.body).toBe("deep");
  });

  it("falls back to the Date header when internalDate is absent", () => {
    const email = toEmail({
      id: "x",
      payload: { mimeType: "text/plain", headers: [{ name: "Date", value: "Tue, 15 Sep 2026 10:00:00 +0000" }] },
    });

    expect(email.receivedAt).toBe("Tue, 15 Sep 2026 10:00:00 +0000");
  });

  it("yields an empty body when there is no readable part", () => {
    expect(toEmail({ id: "x", payload: { mimeType: "multipart/mixed", parts: [] } }).body).toBe("");
  });
});

describe("GmailInbox", () => {
  const inbox = (fetchMock: ReturnType<typeof vi.fn>, query?: string) => {
    vi.stubGlobal("fetch", fetchMock);
    return new GmailInbox({ accessToken: async () => "token-abc", query });
  };

  it("sends the bearer token on every request", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonResponse(message()));
    await inbox(fetchMock).get("18c2f");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init.headers.authorization).toBe("Bearer token-abc");
  });

  // Access tokens expire hourly; a long-lived agent would otherwise start
  // failing mid-run with a token captured at construction.
  it("asks for a fresh token per request", async () => {
    const accessToken = vi.fn().mockResolvedValue("token-abc");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(jsonResponse(message())));
    const source = new GmailInbox({ accessToken });

    await source.get("a");
    await source.get("b");

    expect(accessToken).toHaveBeenCalledTimes(2);
  });

  it("passes the limit and search query through", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonResponse({ messages: [] }));
    await inbox(fetchMock, "in:inbox").list(7);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("maxResults=7");
    expect(url).toContain("q=in%3Ainbox");
  });

  it("omits the query parameter when none is configured", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonResponse({ messages: [] }));
    await inbox(fetchMock).list(5);

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("q=");
  });

  it("fetches each listed message and returns newest first", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/messages?")) {
        return new Response(JSON.stringify({ messages: [{ id: "older" }, { id: "newer" }] }), { status: 200 });
      }
      const id = String(url).includes("newer") ? "newer" : "older";
      const internalDate = id === "newer" ? "1789545600000" : "1789459200000";
      return new Response(JSON.stringify(message({ id, internalDate })), { status: 200 });
    });

    const emails = await inbox(fetchMock).list(10);

    expect(emails.map((e) => e.id)).toEqual(["newer", "older"]);
  });

  it("returns an empty array when the mailbox has no matches", async () => {
    await expect(inbox(vi.fn().mockImplementation(jsonResponse({}))).list(10)).resolves.toEqual([]);
  });

  it("surfaces an API failure rather than returning an empty inbox", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("insufficient scope", { status: 403 }));

    await expect(inbox(fetchMock).list(10)).rejects.toThrow(/GET failed \(403\)/);
  });
});

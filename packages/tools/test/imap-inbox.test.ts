import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  findTextPart,
  formatSender,
  ImapInbox,
  type ImapClientLike,
  type ImapMessageLike,
} from "../src/adapters/imap-inbox";

const OPTIONS = { user: "ops@example.test", appPassword: "app-password-1234" };

const message = (overrides: Partial<ImapMessageLike> = {}): ImapMessageLike => ({
  uid: 42,
  envelope: {
    from: [{ name: "Billing", address: "billing@northwind.test" }],
    subject: "Invoice INV-2291",
    date: new Date("2026-09-15T08:00:00Z"),
  },
  bodyStructure: { type: "text/plain", part: "1" },
  ...overrides,
});

/** Records the protocol interaction so the adapter's sequencing can be asserted. */
class FakeClient implements ImapClientLike {
  readonly calls: string[] = [];
  released = 0;
  private fetching = false;
  constructor(
    private readonly messages: ImapMessageLike[],
    private readonly bodies: Record<string, string> = { "42": "Please find the invoice attached." },
  ) {}

  async connect() {
    this.calls.push("connect");
  }
  async logout() {
    this.calls.push("logout");
  }
  async getMailboxLock(mailbox: string) {
    this.calls.push(`lock:${mailbox}`);
    return {
      release: () => {
        this.released += 1;
        this.calls.push("release");
      },
    };
  }
  get mailbox() {
    return { exists: this.messages.length };
  }
  // Honours the sequence range, so a range that would pull the whole mailbox
  // is visible as wrong output rather than passing silently.
  async *fetch(range: string, _query: Record<string, unknown>, options?: Record<string, unknown>) {
    this.calls.push(`fetch:${range}:uid=${String(options?.uid)}`);
    this.fetching = true;
    try {
    if (options?.uid) {
      for (const m of this.messages.filter((m) => String(m.uid) === range)) yield m;
      return;
    }
    const [from, to] = range.split(":");
    const start = Number(from);
    const end = to === "*" ? this.messages.length : Number(to);
    for (const m of this.messages.slice(start - 1, end)) yield m;
    } finally {
      this.fetching = false;
    }
  }
  async download(uid: string) {
    // IMAP runs one command at a time. A download issued while a FETCH is
    // still streaming deadlocks a real server; fail loudly instead.
    if (this.fetching) throw new Error("download issued while a FETCH was still open");
    this.calls.push(`download:${uid}`);
    const body = this.bodies[uid];
    return body === undefined ? false : { content: Readable.from([Buffer.from(body, "utf8")]) };
  }
}

const inbox = (client: ImapClientLike, overrides = {}) =>
  new ImapInbox({ ...OPTIONS, ...overrides, createClient: async () => client });

describe("findTextPart", () => {
  it("finds the part number of a plain-text body", () => {
    expect(findTextPart({ type: "text/plain", part: "1" })).toBe("1");
  });

  it("prefers text/plain over an html sibling", () => {
    const part = findTextPart({
      type: "multipart/alternative",
      childNodes: [
        { type: "text/html", part: "1" },
        { type: "text/plain", part: "2" },
      ],
    });

    expect(part).toBe("2");
  });

  it("descends into nested multiparts", () => {
    const part = findTextPart({
      type: "multipart/mixed",
      childNodes: [{ type: "multipart/alternative", childNodes: [{ type: "text/plain", part: "1.2" }] }],
    });

    expect(part).toBe("1.2");
  });

  it("falls back to an html-only message rather than returning nothing", () => {
    expect(findTextPart({ type: "text/html", part: "1" })).toBe("1");
  });

  it("returns undefined when there is no text part at all", () => {
    expect(findTextPart({ type: "image/png", part: "1" })).toBeUndefined();
    expect(findTextPart(undefined)).toBeUndefined();
  });
});

describe("formatSender", () => {
  it("combines name and address", () => {
    expect(formatSender({ from: [{ name: "Billing", address: "b@x.test" }] })).toBe("Billing <b@x.test>");
  });

  it("falls back to the bare address", () => {
    expect(formatSender({ from: [{ address: "b@x.test" }] })).toBe("b@x.test");
  });

  it("returns an empty string when the envelope has no sender", () => {
    expect(formatSender({})).toBe("");
    expect(formatSender(undefined)).toBe("");
  });
});

describe("ImapInbox", () => {
  it("maps a message into the domain Email shape", async () => {
    const client = new FakeClient([message()]);

    await expect(inbox(client).list(10)).resolves.toEqual([
      {
        id: "42",
        from: "Billing <billing@northwind.test>",
        subject: "Invoice INV-2291",
        body: "Please find the invoice attached.",
        receivedAt: "2026-09-15T08:00:00.000Z",
      },
    ]);
  });

  // Email ids flow into the hardened email_id schema, which only accepts
  // [A-Za-z0-9_-]. A UID is digits, so it passes; anything else would not.
  it("uses the UID as the id, which satisfies the tool's id pattern", async () => {
    const [email] = await inbox(new FakeClient([message({ uid: 99 })], { "99": "hi" })).list(10);

    expect(email?.id).toBe("99");
    expect(email?.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it("connects, locks the mailbox, and always releases and logs out", async () => {
    const client = new FakeClient([message()]);
    await inbox(client).list(10);

    expect(client.calls[0]).toBe("connect");
    expect(client.calls[1]).toBe("lock:INBOX");
    expect(client.calls.at(-2)).toBe("release");
    expect(client.calls.at(-1)).toBe("logout");
  });

  it("releases the lock and logs out even when the fetch fails", async () => {
    // Needs a non-empty mailbox: an empty one returns early without fetching.
    const client = new FakeClient([message()]);
    vi.spyOn(client, "fetch").mockImplementation(() => {
      throw new Error("connection reset");
    });

    await expect(inbox(client).list(10)).rejects.toThrow(/connection reset/);
    expect(client.released).toBe(1);
    expect(client.calls).toContain("logout");
  });

  it("honours a non-default mailbox", async () => {
    const client = new FakeClient([message()]);
    await inbox(client, { mailbox: "[Gmail]/All Mail" }).list(5);

    expect(client.calls).toContain("lock:[Gmail]/All Mail");
  });

  it("returns newest first and respects the limit", async () => {
    const client = new FakeClient(
      [
        message({ uid: 1, envelope: { subject: "old", date: new Date("2026-09-01T00:00:00Z") } }),
        message({ uid: 3, envelope: { subject: "new", date: new Date("2026-09-19T00:00:00Z") } }),
        message({ uid: 2, envelope: { subject: "mid", date: new Date("2026-09-10T00:00:00Z") } }),
      ],
      { "1": "a", "2": "b", "3": "c" },
    );

    const emails = await inbox(client).list(2);

    expect(emails.map((e) => e.subject)).toEqual(["new", "mid"]);
  });

  it("yields an empty body when the part cannot be downloaded", async () => {
    const client = new FakeClient([message()], {});

    const [email] = await inbox(client).list(10);
    expect(email?.body).toBe("");
  });

  it("falls back to internalDate when the envelope has no date", async () => {
    const client = new FakeClient([
      message({ envelope: { subject: "x" }, internalDate: new Date("2026-01-02T03:04:05Z") }),
    ]);

    const [email] = await inbox(client).list(10);
    expect(email?.receivedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("returns an empty inbox rather than throwing when there is no mail", async () => {
    await expect(inbox(new FakeClient([])).list(10)).resolves.toEqual([]);
  });

  // Regression: the range was `${limit}:*`, which means "message N to the end"
  // - on a real mailbox that is thousands of messages and a body download for
  // each, the exact opposite of a limit.
  it("asks only for the newest N messages, anchored to the message count", async () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      message({ uid: i + 1, envelope: { subject: `m${i + 1}`, date: new Date(2026, 0, 1, 0, i) } }),
    );
    const bodies = Object.fromEntries(many.map((m) => [String(m.uid), "body"]));
    const client = new FakeClient(many, bodies);

    const emails = await inbox(client).list(5);

    expect(client.calls).toContain("fetch:496:500:uid=false");
    expect(emails).toHaveLength(5);
    // One download per returned message, not per mailbox message.
    expect(client.calls.filter((c) => c.startsWith("download:"))).toHaveLength(5);
  });

  it("does not ask for a range below 1 when the mailbox is smaller than the limit", async () => {
    const client = new FakeClient([message({ uid: 1 })], { "1": "body" });

    await inbox(client).list(50);

    expect(client.calls).toContain("fetch:1:1:uid=false");
  });

  describe("get", () => {
    it("fetches one message by UID", async () => {
      const client = new FakeClient([message()]);

      await expect(inbox(client).get("42")).resolves.toMatchObject({ id: "42", subject: "Invoice INV-2291" });
      expect(client.calls).toContain("fetch:42:uid=true");
    });

    it("returns undefined when the UID matches nothing", async () => {
      await expect(inbox(new FakeClient([])).get("999")).resolves.toBeUndefined();
    });

    // A UID is numeric; refusing anything else keeps a crafted id from reaching
    // the IMAP command at all.
    it.each(["../../etc/passwd", "1 OR 1", "abc", "", "1:*"])("refuses the non-numeric id %j", async (id) => {
      const client = new FakeClient([message()]);

      await expect(inbox(client).get(id)).resolves.toBeUndefined();
      expect(client.calls).toEqual([]);
    });
  });
});

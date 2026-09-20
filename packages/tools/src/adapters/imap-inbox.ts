import type { InboxSource } from "../ports";
import type { Email } from "../types";

/**
 * The slice of an IMAP client this adapter uses.
 *
 * Structural, like the Mongo adapter: the behaviour can be tested without a
 * live server, and the concrete client stays behind a factory. A real
 * `ImapFlow` instance satisfies this.
 */
export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(mailbox: string): Promise<{ release(): void }>;
  fetch(
    range: string,
    query: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): AsyncIterable<ImapMessageLike>;
  download(
    uid: string,
    part?: string,
    options?: Record<string, unknown>,
  ): Promise<{ content: NodeJS.ReadableStream } | false>;
}

export interface ImapEnvelopeLike {
  from?: { name?: string; address?: string }[];
  subject?: string;
  date?: Date | string;
}

export interface ImapBodyStructureLike {
  type?: string;
  part?: string;
  childNodes?: ImapBodyStructureLike[];
}

export interface ImapMessageLike {
  uid: number;
  envelope?: ImapEnvelopeLike;
  bodyStructure?: ImapBodyStructureLike;
  internalDate?: Date;
}

export interface ImapInboxOptions {
  user: string;
  /**
   * A Google App Password, not the account password.
   *
   * IMAP is the reason this adapter exists: it uses no OAuth scope at all, so
   * none of Google's restricted-scope verification or annual security
   * assessment applies. See docs/ADAPTERS.md.
   */
  appPassword: string;
  host?: string;
  port?: number;
  mailbox?: string;
  /** Injection point for tests; production uses the default ImapFlow factory. */
  createClient?: (options: ImapInboxOptions) => Promise<ImapClientLike>;
}

const DEFAULTS = { host: "imap.gmail.com", port: 993, mailbox: "INBOX" };

function findPlainPart(node: ImapBodyStructureLike | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "text/plain") return node.part ?? "1";

  for (const child of node.childNodes ?? []) {
    const found = findPlainPart(child);
    if (found) return found;
  }
  return undefined;
}

/** Any text leaf, for messages with no plain alternative. */
function findAnyTextPart(node: ImapBodyStructureLike | undefined): string | undefined {
  if (!node) return undefined;
  if (!node.childNodes?.length) return node.type?.startsWith("text/") ? (node.part ?? "1") : undefined;

  for (const child of node.childNodes) {
    const found = findAnyTextPart(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Prefers text/plain for the same reason the Gmail adapter does: less
 * attacker-controlled markup reaches the prompt.
 *
 * Two passes, not one. A single recursive walk returns whichever text leaf it
 * reaches first, so an HTML alternative listed before the plain one silently
 * inverts the preference — the exact bug this had on the first attempt, and
 * the same one the Gmail adapter had.
 */
export function findTextPart(node: ImapBodyStructureLike | undefined): string | undefined {
  return findPlainPart(node) ?? findAnyTextPart(node);
}

export function formatSender(envelope: ImapEnvelopeLike | undefined): string {
  const [first] = envelope?.from ?? [];
  if (!first) return "";
  return first.name && first.address ? `${first.name} <${first.address}>` : (first.address ?? first.name ?? "");
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

async function defaultClient(options: ImapInboxOptions): Promise<ImapClientLike> {
  // Imported lazily so the module graph stays loadable without a server, and
  // so tests that inject a fake never pull the driver in.
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow({
    host: options.host ?? DEFAULTS.host,
    port: options.port ?? DEFAULTS.port,
    secure: true,
    auth: { user: options.user, pass: options.appPassword },
    logger: false,
  }) as unknown as ImapClientLike;
}

/**
 * Reads a Gmail mailbox over IMAP.
 *
 * Chosen over the REST API because `gmail.readonly` is a Google *restricted*
 * scope, which requires OAuth verification plus a paid annual security
 * assessment. IMAP touches none of that: it is a mail protocol the account
 * already speaks, authenticated with an App Password.
 *
 * Read-only by construction, like every `InboxSource`: nothing here can send,
 * modify or delete mail.
 */
export class ImapInbox implements InboxSource {
  constructor(private readonly options: ImapInboxOptions) {}

  /**
   * Opens a connection, runs the work under a mailbox lock, and always closes.
   *
   * A connection per call rather than a long-lived one: an agent run makes a
   * handful of calls minutes apart, and a held IMAP connection would idle out
   * mid-run and fail in a way that looks like an empty inbox.
   */
  private async withMailbox<T>(work: (client: ImapClientLike) => Promise<T>): Promise<T> {
    const create = this.options.createClient ?? defaultClient;
    const client = await create(this.options);
    await client.connect();

    const lock = await client.getMailboxLock(this.options.mailbox ?? DEFAULTS.mailbox);
    try {
      return await work(client);
    } finally {
      lock.release();
      await client.logout();
    }
  }

  private async toEmail(client: ImapClientLike, message: ImapMessageLike): Promise<Email> {
    const uid = String(message.uid);
    const part = findTextPart(message.bodyStructure);

    let body = "";
    if (part) {
      const downloaded = await client.download(uid, part, { uid: true });
      if (downloaded) body = await readStream(downloaded.content);
    }

    const date = message.envelope?.date ?? message.internalDate;
    return {
      id: uid,
      from: formatSender(message.envelope),
      subject: message.envelope?.subject ?? "",
      body,
      receivedAt: date ? new Date(date).toISOString() : new Date(0).toISOString(),
    };
  }

  async list(limit: number): Promise<Email[]> {
    return this.withMailbox(async (client) => {
      const emails: Email[] = [];
      // Newest first: a descending UID range, capped so a large mailbox cannot
      // pull thousands of bodies.
      for await (const message of client.fetch(
        `${Math.max(1, limit)}:*`,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: false },
      )) {
        emails.push(await this.toEmail(client, message));
      }

      return emails
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, limit);
    });
  }

  async get(id: string): Promise<Email | undefined> {
    if (!/^\d+$/.test(id)) return undefined;

    return this.withMailbox(async (client) => {
      for await (const message of client.fetch(
        id,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      )) {
        return this.toEmail(client, message);
      }
      return undefined;
    });
  }
}

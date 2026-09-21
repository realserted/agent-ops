import { htmlToText, stripInvisible } from "./html-to-text";
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
  /** Populated once a mailbox is selected; `exists` is its message count. */
  mailbox?: { exists: number } | false;
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

export interface ChosenPart {
  part: string;
  /** The body needs converting before a model reads it. */
  isHtml: boolean;
}

function findPlainPart(node: ImapBodyStructureLike | undefined): ChosenPart | undefined {
  if (!node) return undefined;
  if (node.type === "text/plain") return { part: node.part ?? "1", isHtml: false };

  for (const child of node.childNodes ?? []) {
    const found = findPlainPart(child);
    if (found) return found;
  }
  return undefined;
}

/** Any text leaf, for messages with no plain alternative. */
function findAnyTextPart(node: ImapBodyStructureLike | undefined): ChosenPart | undefined {
  if (!node) return undefined;
  if (!node.childNodes?.length) {
    return node.type?.startsWith("text/")
      ? { part: node.part ?? "1", isHtml: node.type === "text/html" }
      : undefined;
  }

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
 *
 * Reports whether the chosen part is HTML, because plenty of real mail is
 * `text/html` with no plain alternative at all and handing that markup to a
 * model costs an order of magnitude more tokens than the text it contains.
 */
export function findTextPart(node: ImapBodyStructureLike | undefined): ChosenPart | undefined {
  return findPlainPart(node) ?? findAnyTextPart(node);
}

export function formatSender(envelope: ImapEnvelopeLike | undefined): string {
  const [first] = envelope?.from ?? [];
  if (!first) return "";
  return first.name && first.address ? `${first.name} <${first.address}>` : (first.address ?? first.name ?? "");
}

/**
 * Drains an async iterable into an array.
 *
 * Exists so the FETCH response is fully consumed before any other IMAP command
 * is issued: the protocol runs one command at a time, and holding a FETCH open
 * while awaiting a download deadlocks the connection.
 */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
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
    const chosen = findTextPart(message.bodyStructure);

    let body = "";
    if (chosen) {
      const downloaded = await client.download(uid, chosen.part, { uid: true });
      if (downloaded) {
        const raw = await readStream(downloaded.content);
        // Plain bodies still need invisibles removed: bulk senders split words
        // with zero-widths, which is both noise for the model and the shape a
        // keyword-splitting injection would take.
        body = chosen.isHtml ? htmlToText(raw) : stripInvisible(raw);
      }
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
      // The range must be anchored to the message count. "10:*" means
      // "message 10 to the end", which on a real mailbox is thousands of
      // messages and a body download for each - the opposite of a limit.
      const exists = typeof client.mailbox === "object" && client.mailbox ? client.mailbox.exists : 0;
      if (exists === 0) return [];

      const start = Math.max(1, exists - limit + 1);

      // Drain the FETCH before downloading anything. IMAP runs one command at
      // a time, so a download issued mid-iteration queues behind a FETCH that
      // cannot finish until the iteration ends - the connection deadlocks and
      // dies on a socket timeout. Only a real server shows this.
      const messages = await collect(
        client.fetch(
          `${start}:${exists}`,
          { uid: true, envelope: true, bodyStructure: true, internalDate: true },
          { uid: false },
        ),
      );

      const emails: Email[] = [];
      for (const message of messages) emails.push(await this.toEmail(client, message));

      return emails.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
    });
  }

  async get(id: string): Promise<Email | undefined> {
    if (!/^\d+$/.test(id)) return undefined;

    return this.withMailbox(async (client) => {
      // Drained first, for the same reason as `list`.
      const [message] = await collect(
        client.fetch(
          id,
          { uid: true, envelope: true, bodyStructure: true, internalDate: true },
          { uid: true },
        ),
      );

      return message ? this.toEmail(client, message) : undefined;
    });
  }
}

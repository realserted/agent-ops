import { requestJson } from "./http";
import { htmlToText, looksLikeHtml, stripInvisible } from "./html-to-text";
import type { InboxSource } from "../ports";
import type { Email } from "../types";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailListResponse {
  messages?: { id: string }[];
}

/** Gmail returns base64url, which differs from base64 in two characters. */
function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

const header = (payload: GmailPart | undefined, name: string): string =>
  payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/**
 * Walks the MIME tree for the plain-text body.
 *
 * Prefers text/plain over text/html: the HTML alternative of the same message
 * carries markup that reads as structure to a model, and hidden text is one of
 * the injection patterns the guardrails look for. Taking the plain part means
 * less attacker-controlled formatting reaches the prompt in the first place.
 */
function findPlain(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return stripInvisible(decodeBody(part.body.data));

  for (const child of part.parts ?? []) {
    const found = findPlain(child);
    if (found) return found;
  }
  return "";
}

/**
 * Any leaf body, for single-part messages and ones with no plain alternative.
 *
 * Converts when the leaf is HTML: plenty of transactional mail is `text/html`
 * only, and handing a model ~20k characters of markup costs an order of
 * magnitude more tokens than the text inside it.
 */
function findAnyLeaf(part: GmailPart | undefined): string {
  if (!part) return "";
  if (!part.parts?.length) {
    if (!part.body?.data) return "";
    const decoded = decodeBody(part.body.data);
    return part.mimeType === "text/html" || looksLikeHtml(decoded)
      ? htmlToText(decoded)
      : stripInvisible(decoded);
  }

  for (const child of part.parts) {
    const found = findAnyLeaf(child);
    if (found) return found;
  }
  return "";
}

function extractBody(part: GmailPart | undefined): string {
  // Two passes on purpose: a single recursive walk returns whichever leaf it
  // reaches first, so an HTML alternative listed before the plain one wins and
  // the preference is silently inverted.
  return findPlain(part) || findAnyLeaf(part);
}

export function toEmail(message: GmailMessage): Email {
  const internal = Number(message.internalDate);
  return {
    id: message.id,
    from: header(message.payload, "From"),
    subject: header(message.payload, "Subject"),
    body: extractBody(message.payload),
    receivedAt: Number.isFinite(internal)
      ? new Date(internal).toISOString()
      : (header(message.payload, "Date") || new Date(0).toISOString()),
  };
}

export interface GmailInboxOptions {
  /**
   * OAuth 2.0 access token with the `gmail.readonly` scope.
   *
   * A function, not a string: access tokens expire in an hour, and a long-lived
   * agent process would otherwise start failing mid-run. The caller owns
   * refresh.
   */
  accessToken: () => Promise<string>;
  /** Gmail search query, e.g. "in:inbox -category:promotions". */
  query?: string;
}

/**
 * Reads a real Gmail inbox through the REST API.
 *
 * Read-only by construction: `InboxSource` has no write operations, and the
 * scope this needs cannot send or delete mail.
 */
export class GmailInbox implements InboxSource {
  constructor(private readonly options: GmailInboxOptions) {}

  private async authHeaders(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.options.accessToken()}` };
  }

  async list(limit: number): Promise<Email[]> {
    const params = new URLSearchParams({ maxResults: String(limit) });
    if (this.options.query) params.set("q", this.options.query);

    const listed = await requestJson<GmailListResponse>(`${BASE_URL}/messages?${params}`, {
      headers: await this.authHeaders(),
    });

    const ids = (listed.messages ?? []).map((m) => m.id);
    const emails = await Promise.all(ids.map(async (id) => this.get(id)));
    return emails
      .filter((email): email is Email => email !== undefined)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async get(id: string): Promise<Email | undefined> {
    const message = await requestJson<GmailMessage | null>(`${BASE_URL}/messages/${id}?format=full`, {
      headers: await this.authHeaders(),
    });
    return message ? toEmail(message) : undefined;
  }
}

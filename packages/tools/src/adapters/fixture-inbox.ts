import { readFile } from "node:fs/promises";
import type { InboxSource } from "../ports";
import type { Email } from "../types";

const DEFAULT_FIXTURE = new URL("../../fixtures/emails.json", import.meta.url);

export class FixtureInbox implements InboxSource {
  constructor(private readonly emails: Email[]) {}

  static async fromFile(path: URL | string = DEFAULT_FIXTURE): Promise<FixtureInbox> {
    return new FixtureInbox(JSON.parse(await readFile(path, "utf8")) as Email[]);
  }

  async list(limit: number): Promise<Email[]> {
    return [...this.emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
  }

  async get(id: string): Promise<Email | undefined> {
    return this.emails.find((email) => email.id === id);
  }
}

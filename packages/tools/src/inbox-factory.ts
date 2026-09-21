import { z } from "zod";
import { FixtureInbox } from "./adapters/fixture-inbox";
import { ImapInbox } from "./adapters/imap-inbox";
import type { InboxSource } from "./ports";

const optional = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || undefined : value),
  z.string().optional(),
);

const EnvSchema = z.object({
  GMAIL_IMAP_USER: optional,
  GMAIL_IMAP_APP_PASSWORD: optional,
  GMAIL_IMAP_MAILBOX: optional,
});

export interface InboxChoice {
  inbox: InboxSource;
  /** What was selected, for the operator to see before a run touches real mail. */
  description: string;
  live: boolean;
}

/**
 * Chooses the inbox from the environment.
 *
 * Defaults to the fixture. Reading someone's real mail is never the default:
 * it has to be asked for by setting both IMAP variables, and a half-configured
 * environment is an error rather than a silent fall back to fixtures - a run
 * that quietly triaged five fake emails when you meant your own inbox looks
 * like it worked.
 */
export function createInbox(env: NodeJS.ProcessEnv = process.env): InboxChoice {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid inbox environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}.`,
    );
  }

  const { GMAIL_IMAP_USER: user, GMAIL_IMAP_APP_PASSWORD: appPassword, GMAIL_IMAP_MAILBOX: mailbox } = parsed.data;

  if (!user && !appPassword) {
    return { inbox: new FixtureInbox([]), description: "fixture inbox", live: false };
  }

  if (!user || !appPassword) {
    const missing = user ? "GMAIL_IMAP_APP_PASSWORD" : "GMAIL_IMAP_USER";
    throw new Error(`Missing ${missing}. Set both IMAP variables, or neither to use the fixture inbox.`);
  }

  return {
    inbox: new ImapInbox({ user, appPassword, ...(mailbox && { mailbox }) }),
    description: `Gmail over IMAP (${user}${mailbox ? `, ${mailbox}` : ""})`,
    live: true,
  };
}

/**
 * The fixture inbox needs its file read, which `createInbox` cannot do
 * synchronously. Callers use this so both branches are awaited the same way.
 */
export async function loadInbox(env: NodeJS.ProcessEnv = process.env): Promise<InboxChoice> {
  const choice = createInbox(env);
  return choice.live ? choice : { ...choice, inbox: await FixtureInbox.fromFile() };
}

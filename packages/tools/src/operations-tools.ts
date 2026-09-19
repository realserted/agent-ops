import { z } from "zod";
import { defineTool, detectSecrets, extractUrls, type Tool } from "@agent-ops/core";
import type { InboxSource, OperationsStore } from "./ports";
import { RECORD_KINDS } from "./types";

export interface OperationsToolDeps {
  inbox: InboxSource;
  store: OperationsStore;
}

const MAX_DRAFT_BODY = 5_000;
const MAX_FLAG_REASON = 1_000;
const MAX_RECORD_FIELDS = 30;
const MAX_FIELD_NAME = 64;
const MAX_FIELD_VALUE = 1_000;

/** Ids come from the model, which may have read an attacker's text. Keep them boring. */
const emailId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "email_id must be 1-64 characters of letters, digits, underscore or hyphen")
  .describe("The email id returned by list_emails");

export function createOperationsTools({ inbox, store }: OperationsToolDeps): Tool[] {
  const requireEmail = async (id: string) => {
    const email = await inbox.get(id);
    if (!email) throw new Error(`No email with id "${id}". Call list_emails to get valid ids.`);
    return email;
  };

  return [
    defineTool({
      name: "list_emails",
      description: "List recent inbox emails with id, sender, subject and date. Use get_email to read a body.",
      schema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      untrustedOutput: true,
      execute: async ({ limit }) => ({
        emails: (await inbox.list(limit)).map(({ body: _, ...summary }) => summary),
      }),
    }),

    defineTool({
      name: "get_email",
      description: "Read the full content of one email.",
      schema: z.object({ email_id: emailId }),
      untrustedOutput: true,
      execute: async ({ email_id }) => requireEmail(email_id),
    }),

    defineTool({
      name: "create_record",
      description:
        "Create a structured business record extracted from an email. Requires human approval. " +
        "Use fields for extracted values, e.g. company, amount, due_date, issue.",
      requiresApproval: true,
      schema: z.object({
        email_id: emailId,
        kind: z.enum(RECORD_KINDS),
        fields: z
          .array(
            z.object({
              name: z.string().min(1).max(MAX_FIELD_NAME),
              value: z.string().max(MAX_FIELD_VALUE),
            }),
          )
          .min(1)
          .max(MAX_RECORD_FIELDS),
      }),
      execute: async ({ email_id, kind, fields }) => {
        await requireEmail(email_id);
        const data = Object.fromEntries(fields.map(({ name, value }) => [name, value]));
        return store.createRecord({ emailId: email_id, kind, data });
      },
    }),

    defineTool({
      name: "draft_reply",
      description:
        "Save a draft reply to an email. Drafts are never sent automatically. " +
        "Only use links that already appear in the email you are replying to.",
      schema: z.object({ email_id: emailId, body: z.string().min(1).max(MAX_DRAFT_BODY) }),
      execute: async ({ email_id, body }) => {
        const email = await requireEmail(email_id);

        // Injected instructions reach the outside world through drafts, so this
        // is where exfiltration and phishing links are stopped rather than
        // merely flagged.
        const known = new Set(extractUrls(`${email.body} ${email.subject} ${email.from}`));
        const foreign = extractUrls(body).filter((url) => !known.has(url));
        if (foreign.length > 0) {
          throw new Error(
            `Draft rejected: it contains ${foreign.length} link(s) that do not appear in the source email ` +
              `(${foreign.join(", ")}). Only reuse links from the email you are replying to.`,
          );
        }

        const secrets = detectSecrets(body);
        if (secrets.length > 0) {
          throw new Error(
            `Draft rejected: it looks like it contains a credential (${secrets.join(", ")}). ` +
              "Never include keys, tokens or secrets in a reply.",
          );
        }

        return store.saveDraft({ emailId: email_id, body });
      },
    }),

    defineTool({
      name: "flag_for_review",
      description: "Flag an email for a human when it is suspicious, ambiguous, or outside your scope.",
      schema: z.object({ email_id: emailId, reason: z.string().min(1).max(MAX_FLAG_REASON) }),
      execute: async ({ email_id, reason }) => {
        await requireEmail(email_id);
        return store.flagForReview({ emailId: email_id, reason });
      },
    }),
  ];
}

import { z } from "zod";
import { defineTool, type Tool } from "@agent-ops/core";
import type { InboxSource, OperationsStore } from "./ports";
import { RECORD_KINDS } from "./types";

export interface OperationsToolDeps {
  inbox: InboxSource;
  store: OperationsStore;
}

const emailId = z.string().describe("The email id returned by list_emails");

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
      execute: async ({ limit }) => ({
        emails: (await inbox.list(limit)).map(({ body: _, ...summary }) => summary),
      }),
    }),

    defineTool({
      name: "get_email",
      description: "Read the full content of one email.",
      schema: z.object({ email_id: emailId }),
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
        fields: z.array(z.object({ name: z.string(), value: z.string() })).min(1),
      }),
      execute: async ({ email_id, kind, fields }) => {
        await requireEmail(email_id);
        const data = Object.fromEntries(fields.map(({ name, value }) => [name, value]));
        return store.createRecord({ emailId: email_id, kind, data });
      },
    }),

    defineTool({
      name: "draft_reply",
      description: "Save a draft reply to an email. Drafts are never sent automatically.",
      schema: z.object({ email_id: emailId, body: z.string().min(1) }),
      execute: async ({ email_id, body }) => {
        await requireEmail(email_id);
        return store.saveDraft({ emailId: email_id, body });
      },
    }),

    defineTool({
      name: "flag_for_review",
      description: "Flag an email for a human when it is suspicious, ambiguous, or outside your scope.",
      schema: z.object({ email_id: emailId, reason: z.string().min(1) }),
      execute: async ({ email_id, reason }) => {
        await requireEmail(email_id);
        return store.flagForReview({ emailId: email_id, reason });
      },
    }),
  ];
}

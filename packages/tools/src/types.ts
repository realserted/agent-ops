export const RECORD_KINDS = ["lead", "invoice", "support_ticket"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface Email {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

interface Entity {
  id: string;
  emailId: string;
  createdAt: string;
}

export interface OperationsRecord extends Entity {
  kind: RecordKind;
  data: Record<string, string>;
}

export interface Draft extends Entity {
  body: string;
}

export interface ReviewFlag extends Entity {
  reason: string;
}

export type NewEntity<T extends Entity> = Omit<T, "id" | "createdAt">;

import type { Draft, Email, NewEntity, OperationsRecord, ReviewFlag } from "./types";

/** Where emails come from. Fixture-backed now, Gmail-backed later. */
export interface InboxSource {
  list(limit: number): Promise<Email[]>;
  get(id: string): Promise<Email | undefined>;
}

/** Where agent output is persisted. In-memory now, Supabase later. */
export interface OperationsStore {
  createRecord(input: NewEntity<OperationsRecord>): Promise<OperationsRecord>;
  saveDraft(input: NewEntity<Draft>): Promise<Draft>;
  flagForReview(input: NewEntity<ReviewFlag>): Promise<ReviewFlag>;
}

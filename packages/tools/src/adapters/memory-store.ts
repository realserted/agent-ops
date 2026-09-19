import { randomUUID } from "node:crypto";
import type { OperationsStore } from "../ports";
import type { Draft, NewEntity, OperationsRecord, ReviewFlag } from "../types";

const stamp = <T extends object>(input: T) => ({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });

export class InMemoryOperationsStore implements OperationsStore {
  readonly records: OperationsRecord[] = [];
  readonly drafts: Draft[] = [];
  readonly flags: ReviewFlag[] = [];

  async createRecord(input: NewEntity<OperationsRecord>): Promise<OperationsRecord> {
    const record = stamp(input);
    this.records.push(record);
    return record;
  }

  async saveDraft(input: NewEntity<Draft>): Promise<Draft> {
    const draft = stamp(input);
    this.drafts.push(draft);
    return draft;
  }

  async flagForReview(input: NewEntity<ReviewFlag>): Promise<ReviewFlag> {
    const flag = stamp(input);
    this.flags.push(flag);
    return flag;
  }
}

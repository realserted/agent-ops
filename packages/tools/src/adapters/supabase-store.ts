import { requestJson } from "./http";
import type { OperationsStore } from "../ports";
import type { Draft, NewEntity, OperationsRecord, ReviewFlag } from "../types";

export interface SupabaseStoreOptions {
  /** Project URL, e.g. https://abcdefgh.supabase.co */
  url: string;
  /**
   * Service role or anon key.
   *
   * With row-level security on — which it should be — the anon key is enough
   * and the policy decides what this agent may write. The service role key
   * bypasses RLS entirely and should be reserved for trusted server contexts.
   */
  apiKey: string;
  tables?: Partial<typeof DEFAULT_TABLES>;
}

export const DEFAULT_TABLES = {
  records: "operations_records",
  drafts: "drafts",
  flags: "review_flags",
} as const;

/** Postgres columns are snake_case; the domain types are camelCase. */
interface RecordRow {
  id: string;
  email_id: string;
  created_at: string;
  kind: OperationsRecord["kind"];
  data: Record<string, string>;
}
interface DraftRow {
  id: string;
  email_id: string;
  created_at: string;
  body: string;
}
interface FlagRow {
  id: string;
  email_id: string;
  created_at: string;
  reason: string;
}

/**
 * Persists operations output to Supabase over PostgREST.
 *
 * `id` and `created_at` are left to Postgres defaults rather than generated
 * here, so two processes writing concurrently cannot disagree about ordering
 * or collide on an id.
 */
export class SupabaseOperationsStore implements OperationsStore {
  private readonly tables: typeof DEFAULT_TABLES;

  constructor(private readonly options: SupabaseStoreOptions) {
    this.tables = { ...DEFAULT_TABLES, ...options.tables };
  }

  private async insert<Row>(table: string, row: Record<string, unknown>): Promise<Row> {
    const inserted = await requestJson<Row[]>(`${this.options.url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: this.options.apiKey,
        authorization: `Bearer ${this.options.apiKey}`,
        // Without this PostgREST returns 201 with an empty body, and the
        // caller needs the generated id and timestamp back.
        prefer: "return=representation",
      },
      body: row,
    });

    const [first] = inserted ?? [];
    if (!first) throw new Error(`Supabase insert into "${table}" returned no row.`);
    return first;
  }

  async createRecord(input: NewEntity<OperationsRecord>): Promise<OperationsRecord> {
    const row = await this.insert<RecordRow>(this.tables.records, {
      email_id: input.emailId,
      kind: input.kind,
      data: input.data,
    });
    return { id: row.id, emailId: row.email_id, createdAt: row.created_at, kind: row.kind, data: row.data };
  }

  async saveDraft(input: NewEntity<Draft>): Promise<Draft> {
    const row = await this.insert<DraftRow>(this.tables.drafts, {
      email_id: input.emailId,
      body: input.body,
    });
    return { id: row.id, emailId: row.email_id, createdAt: row.created_at, body: row.body };
  }

  async flagForReview(input: NewEntity<ReviewFlag>): Promise<ReviewFlag> {
    const row = await this.insert<FlagRow>(this.tables.flags, {
      email_id: input.emailId,
      reason: input.reason,
    });
    return { id: row.id, emailId: row.email_id, createdAt: row.created_at, reason: row.reason };
  }
}

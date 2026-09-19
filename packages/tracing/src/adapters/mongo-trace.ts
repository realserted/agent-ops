import type { TraceEvent, TraceRun, TraceStore } from "../ports";

/**
 * The slice of a MongoDB collection this adapter uses.
 *
 * Structural rather than an import of the driver: `packages/tracing` stays
 * dependency-free, the adapter is testable without a server, and the app
 * chooses its own driver version. A real `Collection<T>` satisfies this.
 */
export interface MongoLikeCollection<T> {
  insertOne(doc: T): Promise<unknown>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  findOne(filter: Record<string, unknown>): Promise<T | null>;
  find(filter: Record<string, unknown>): {
    sort(spec: Record<string, 1 | -1>): { limit(n: number): { toArray(): Promise<T[]> } };
    toArray(): Promise<T[]>;
  };
  createIndex?(spec: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface MongoTraceCollections {
  runs: MongoLikeCollection<TraceRun>;
  events: MongoLikeCollection<TraceEvent>;
}

/**
 * Persists traces to MongoDB.
 *
 * Wiring, in a composition root:
 *
 * ```ts
 * const client = new MongoClient(process.env.MONGODB_URI!);
 * await client.connect();
 * const db = client.db("agent_ops");
 * const store = new MongoTraceStore({
 *   runs: db.collection("trace_runs"),
 *   events: db.collection("trace_events"),
 * });
 * await store.ensureIndexes();
 * ```
 */
export class MongoTraceStore implements TraceStore {
  constructor(private readonly collections: MongoTraceCollections) {}

  /** Call once at startup: listRuns sorts by startedAt, getRun reads by traceId. */
  async ensureIndexes(): Promise<void> {
    await this.collections.runs.createIndex?.({ traceId: 1 }, { unique: true });
    await this.collections.runs.createIndex?.({ startedAt: -1 });
    await this.collections.events.createIndex?.({ traceId: 1, sequence: 1 });
  }

  async startRun(run: TraceRun): Promise<void> {
    await this.collections.runs.insertOne(run);
  }

  async appendEvent(event: TraceEvent): Promise<void> {
    await this.collections.events.insertOne(event);
  }

  async finishRun(traceId: string, summary: Partial<TraceRun>): Promise<void> {
    await this.collections.runs.updateOne({ traceId }, { $set: summary });
  }

  async listRuns(limit: number): Promise<TraceRun[]> {
    return this.collections.runs.find({}).sort({ startedAt: -1 }).limit(limit).toArray();
  }

  async getRun(traceId: string): Promise<{ run: TraceRun; events: TraceEvent[] } | undefined> {
    const run = await this.collections.runs.findOne({ traceId });
    if (!run) return undefined;

    const events = await this.collections.events.find({ traceId }).sort({ sequence: 1 }).limit(10_000).toArray();
    return { run, events };
  }
}

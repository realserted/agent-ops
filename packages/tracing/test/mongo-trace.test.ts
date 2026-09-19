import { beforeEach, describe, expect, it } from "vitest";
import { MongoTraceStore, type MongoLikeCollection } from "../src/adapters/mongo-trace";
import type { TraceEvent, TraceRun } from "../src/ports";

/** A collection that behaves like the driver's, so the mapping can be tested offline. */
class FakeCollection<T extends Record<string, unknown>> implements MongoLikeCollection<T> {
  readonly docs: T[] = [];
  readonly indexes: Record<string, unknown>[] = [];

  async insertOne(doc: T) {
    this.docs.push({ ...doc });
    return { acknowledged: true };
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
    const index = this.docs.findIndex((d) => this.matches(d, filter));
    if (index >= 0) {
      this.docs[index] = { ...this.docs[index], ...(update.$set as Partial<T>) } as T;
    }
    return { matchedCount: index >= 0 ? 1 : 0 };
  }

  async findOne(filter: Record<string, unknown>) {
    return this.docs.find((d) => this.matches(d, filter)) ?? null;
  }

  find(filter: Record<string, unknown>) {
    const matched = this.docs.filter((d) => this.matches(d, filter));
    const chain = {
      sort: (spec: Record<string, 1 | -1>) => {
        const [field, direction] = Object.entries(spec)[0] ?? ["", 1];
        const sorted = [...matched].sort((a, b) => {
          const left = String(a[field] ?? "");
          const right = String(b[field] ?? "");
          return direction === 1 ? left.localeCompare(right) : right.localeCompare(left);
        });
        return { limit: (n: number) => ({ toArray: async () => sorted.slice(0, n) }) };
      },
      toArray: async () => matched,
    };
    return chain;
  }

  async createIndex(spec: Record<string, 1 | -1>, options?: Record<string, unknown>) {
    this.indexes.push({ spec, options });
    return "ok";
  }

  private matches(doc: T, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => doc[key] === value);
  }
}

const run = (traceId: string, startedAt: string): TraceRun => ({
  traceId,
  startedAt,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  task: "Triage the inbox.",
});

const event = (traceId: string, sequence: number): TraceEvent => ({
  traceId,
  sequence,
  recordedAt: "2026-09-19T00:00:00Z",
  event: { type: "guardrail", step: 1, tool: "get_email", warnings: ["role_impersonation"] },
});

let runs: FakeCollection<TraceRun & Record<string, unknown>>;
let events: FakeCollection<TraceEvent & Record<string, unknown>>;
let store: MongoTraceStore;

beforeEach(() => {
  runs = new FakeCollection();
  events = new FakeCollection();
  store = new MongoTraceStore({ runs, events });
});

describe("MongoTraceStore", () => {
  it("inserts a run document", async () => {
    await store.startRun(run("t1", "2026-09-19T01:00:00Z"));

    expect(runs.docs).toHaveLength(1);
    expect(runs.docs[0]).toMatchObject({ traceId: "t1", model: "claude-haiku-4-5" });
  });

  it("appends events to their own collection", async () => {
    await store.appendEvent(event("t1", 0));

    expect(events.docs).toHaveLength(1);
    expect(runs.docs).toHaveLength(0);
  });

  it("merges the summary into the existing run rather than replacing it", async () => {
    await store.startRun(run("t1", "2026-09-19T01:00:00Z"));
    await store.finishRun("t1", { status: "completed", steps: 3, cost: 0.0004 });

    expect(runs.docs[0]).toMatchObject({
      traceId: "t1",
      task: "Triage the inbox.",
      status: "completed",
      steps: 3,
      cost: 0.0004,
    });
  });

  it("lists runs newest first, limited", async () => {
    await store.startRun(run("a", "2026-09-19T01:00:00Z"));
    await store.startRun(run("b", "2026-09-19T03:00:00Z"));
    await store.startRun(run("c", "2026-09-19T02:00:00Z"));

    expect((await store.listRuns(2)).map((r) => r.traceId)).toEqual(["b", "c"]);
  });

  it("returns a run with its events ordered by sequence", async () => {
    await store.startRun(run("t1", "2026-09-19T01:00:00Z"));
    await store.appendEvent(event("t1", 1));
    await store.appendEvent(event("t1", 0));

    const found = await store.getRun("t1");

    expect(found?.run.traceId).toBe("t1");
    expect(found?.events.map((e) => e.sequence)).toEqual([0, 1]);
  });

  it("does not return another run's events", async () => {
    await store.startRun(run("t1", "2026-09-19T01:00:00Z"));
    await store.appendEvent(event("t1", 0));
    await store.appendEvent(event("t2", 0));

    expect((await store.getRun("t1"))?.events).toHaveLength(1);
  });

  it("returns undefined for an unknown trace", async () => {
    expect(await store.getRun("missing")).toBeUndefined();
  });

  it("creates the indexes the queries rely on", async () => {
    await store.ensureIndexes();

    expect(runs.indexes).toEqual([
      { spec: { traceId: 1 }, options: { unique: true } },
      { spec: { startedAt: -1 }, options: undefined },
    ]);
    expect(events.indexes).toEqual([{ spec: { traceId: 1, sequence: 1 }, options: undefined }]);
  });

  it("tolerates a collection without createIndex", async () => {
    const minimal = new FakeCollection<TraceRun & Record<string, unknown>>();
    Reflect.deleteProperty(minimal, "createIndex");

    await expect(
      new MongoTraceStore({
        runs: { ...minimal, createIndex: undefined } as never,
        events: { ...minimal, createIndex: undefined } as never,
      }).ensureIndexes(),
    ).resolves.toBeUndefined();
  });
});

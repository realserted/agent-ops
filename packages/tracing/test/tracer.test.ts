import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentRunResult } from "@agent-ops/core";
import { InMemoryTraceStore } from "../src/adapters/memory-trace";
import { startTrace } from "../src/tracer";
import type { TraceStore } from "../src/ports";

const OPTIONS = { provider: "anthropic", model: "claude-haiku-4-5", task: "Triage the inbox." };

const llmEvent = (step: number): AgentEvent => ({
  type: "llm_response",
  step,
  content: "",
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5 },
  durationMs: 100,
});

const result = (overrides: Partial<AgentRunResult> = {}): AgentRunResult => ({
  runId: "run-123",
  status: "completed",
  output: "done",
  steps: 2,
  usage: { inputTokens: 20_000, outputTokens: 4_000 },
  messages: [],
  ...overrides,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("TraceSession", () => {
  it("records the run before any events arrive", async () => {
    const store = new InMemoryTraceStore();
    const session = await startTrace(store, OPTIONS);

    expect(store.runs.get(session.traceId)).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      task: "Triage the inbox.",
    });
  });

  it("gives each session a distinct trace id", async () => {
    const store = new InMemoryTraceStore();
    const [a, b] = await Promise.all([startTrace(store, OPTIONS), startTrace(store, OPTIONS)]);

    expect(a.traceId).not.toBe(b.traceId);
  });

  it("appends events in order with a monotonic sequence", async () => {
    const store = new InMemoryTraceStore();
    const session = await startTrace(store, OPTIONS);

    session.record(llmEvent(1));
    session.record(llmEvent(2));
    await flush();

    const events = store.events.get(session.traceId) ?? [];
    expect(events.map((e) => e.sequence)).toEqual([0, 1]);
    expect(events.map((e) => (e.event.type === "llm_response" ? e.event.step : -1))).toEqual([1, 2]);
  });

  it("records the agent's run id, status, usage and cost on finish", async () => {
    const store = new InMemoryTraceStore();
    const session = await startTrace(store, OPTIONS);

    await session.finish(result());

    // 20k in at $1/MTok plus 4k out at $5/MTok.
    expect(store.runs.get(session.traceId)).toMatchObject({
      runId: "run-123",
      status: "completed",
      steps: 2,
      cost: 0.04,
    });
  });

  it("leaves cost undefined when the model has no published price", async () => {
    const store = new InMemoryTraceStore();
    const session = await startTrace(store, { ...OPTIONS, model: "unknown-model" });

    await session.finish(result());

    expect(store.runs.get(session.traceId)?.cost).toBeUndefined();
  });

  it("records a failed run with its error", async () => {
    const store = new InMemoryTraceStore();
    const session = await startTrace(store, OPTIONS);

    await session.fail(new Error("provider unreachable"));

    expect(store.runs.get(session.traceId)).toMatchObject({ error: "provider unreachable" });
  });

  // Tracing observes the run; it must never be able to end it.
  it("does not throw when the store fails, and warns only once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: TraceStore = {
      startRun: async () => {},
      appendEvent: async () => {
        throw new Error("mongo unreachable");
      },
      finishRun: async () => {},
      listRuns: async () => [],
      getRun: async () => undefined,
    };

    const session = await startTrace(failing, OPTIONS);
    expect(() => {
      session.record(llmEvent(1));
      session.record(llmEvent(2));
    }).not.toThrow();
    await flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/Tracing disabled.*mongo unreachable/);
    warn.mockRestore();
  });
});

describe("InMemoryTraceStore", () => {
  it("lists runs newest first and respects the limit", async () => {
    const store = new InMemoryTraceStore();
    for (const [traceId, startedAt] of [
      ["a", "2026-09-19T01:00:00Z"],
      ["b", "2026-09-19T03:00:00Z"],
      ["c", "2026-09-19T02:00:00Z"],
    ] as const) {
      await store.startRun({ traceId, startedAt, provider: "p", model: "m", task: "t" });
    }

    expect((await store.listRuns(2)).map((r) => r.traceId)).toEqual(["b", "c"]);
  });

  it("returns a run with its events", async () => {
    const store = new InMemoryTraceStore();
    const session = await startTrace(store, OPTIONS);
    session.record(llmEvent(1));
    await flush();

    const found = await store.getRun(session.traceId);
    expect(found?.events).toHaveLength(1);
  });

  it("returns undefined for an unknown trace", async () => {
    expect(await new InMemoryTraceStore().getRun("nope")).toBeUndefined();
  });

  it("rejects events for a run that was never started", async () => {
    const store = new InMemoryTraceStore();

    await expect(
      store.appendEvent({ traceId: "ghost", sequence: 0, recordedAt: "now", event: llmEvent(1) }),
    ).rejects.toThrow(/No run started/);
  });
});

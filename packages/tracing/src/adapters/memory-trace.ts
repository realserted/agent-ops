import type { TraceEvent, TraceRun, TraceStore } from "../ports";

/** In-process trace store: backs the tests and local runs without a database. */
export class InMemoryTraceStore implements TraceStore {
  readonly runs = new Map<string, TraceRun>();
  readonly events = new Map<string, TraceEvent[]>();

  async startRun(run: TraceRun): Promise<void> {
    this.runs.set(run.traceId, { ...run });
    this.events.set(run.traceId, []);
  }

  async appendEvent(event: TraceEvent): Promise<void> {
    const existing = this.events.get(event.traceId);
    if (!existing) throw new Error(`No run started for trace ${event.traceId}`);
    existing.push(event);
  }

  async finishRun(traceId: string, summary: Partial<TraceRun>): Promise<void> {
    const run = this.runs.get(traceId);
    if (!run) throw new Error(`No run started for trace ${traceId}`);
    this.runs.set(traceId, { ...run, ...summary });
  }

  async listRuns(limit: number): Promise<TraceRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  async getRun(traceId: string): Promise<{ run: TraceRun; events: TraceEvent[] } | undefined> {
    const run = this.runs.get(traceId);
    if (!run) return undefined;
    return { run, events: [...(this.events.get(traceId) ?? [])] };
  }
}

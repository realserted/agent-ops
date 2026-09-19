import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentRunResult } from "@agent-ops/core";
import { estimateCost } from "./cost";
import type { TraceRun, TraceStore } from "./ports";

export interface TraceSessionOptions {
  provider: string;
  model: string;
  task: string;
}

/**
 * One traced agent run.
 *
 * The session owns the correlation id rather than reading the agent's runId,
 * because events are emitted before `run` returns and would otherwise have
 * nothing to attach to. The agent's own runId is recorded on completion.
 */
export class TraceSession {
  readonly traceId = randomUUID();
  private sequence = 0;
  private failed = false;

  constructor(
    private readonly store: TraceStore,
    private readonly options: TraceSessionOptions,
  ) {}

  async start(): Promise<void> {
    await this.store.startRun({
      traceId: this.traceId,
      provider: this.options.provider,
      model: this.options.model,
      task: this.options.task,
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Pass as the agent's `onEvent`.
   *
   * Tracing must never take down the run it is observing, so a failing store
   * is swallowed after being reported once. Losing a trace is an inconvenience;
   * losing the triage run because the database blinked is an outage.
   */
  readonly record = (event: AgentEvent): void => {
    void this.store
      .appendEvent({
        traceId: this.traceId,
        sequence: this.sequence++,
        recordedAt: new Date().toISOString(),
        event,
      })
      .catch((error: unknown) => {
        if (this.failed) return;
        this.failed = true;
        console.warn(`Tracing disabled for this run: ${error instanceof Error ? error.message : error}`);
      });
  };

  async finish(result: AgentRunResult): Promise<TraceRun> {
    const summary: Partial<TraceRun> = {
      runId: result.runId,
      endedAt: new Date().toISOString(),
      status: result.status,
      steps: result.steps,
      usage: result.usage,
      cost: estimateCost(this.options.model, result.usage),
    };
    await this.store.finishRun(this.traceId, summary);
    return { traceId: this.traceId, ...this.options, startedAt: "", ...summary } as TraceRun;
  }

  async fail(error: unknown): Promise<void> {
    await this.store.finishRun(this.traceId, {
      endedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Opens a traced session and marks it started. */
export async function startTrace(store: TraceStore, options: TraceSessionOptions): Promise<TraceSession> {
  const session = new TraceSession(store, options);
  await session.start();
  return session;
}

import type { AgentEvent, AgentRunResult, TokenUsage } from "@agent-ops/core";

export interface TraceRun {
  /** Correlation id, assigned when the run starts. */
  traceId: string;
  /** The agent's own run id, available once the run completes. */
  runId?: string;
  provider: string;
  model: string;
  task: string;
  startedAt: string;
  endedAt?: string;
  status?: AgentRunResult["status"];
  steps?: number;
  usage?: TokenUsage;
  /** USD, or undefined when the model has no published price. */
  cost?: number;
  error?: string;
}

export interface TraceEvent {
  traceId: string;
  sequence: number;
  recordedAt: string;
  event: AgentEvent;
}

/**
 * Where traces are persisted.
 *
 * A port, like InboxSource and OperationsStore: the in-memory adapter backs the
 * tests and local runs, MongoDB backs deployment, and neither the agent nor the
 * tools know which is in use.
 */
export interface TraceStore {
  startRun(run: TraceRun): Promise<void>;
  appendEvent(event: TraceEvent): Promise<void>;
  finishRun(traceId: string, summary: Partial<TraceRun>): Promise<void>;
  /** Most recent runs first. */
  listRuns(limit: number): Promise<TraceRun[]>;
  getRun(traceId: string): Promise<{ run: TraceRun; events: TraceEvent[] } | undefined>;
}

import { randomUUID } from "node:crypto";
import type { Approver, ToolCall } from "@agent-ops/core";

export interface PendingApproval {
  id: string;
  traceId?: string;
  toolName: string;
  args: Record<string, unknown>;
  requestedAt: string;
}

export type ApprovalDecision = "approved" | "denied" | "expired";

export interface ResolvedApproval extends PendingApproval {
  decision: ApprovalDecision;
  decidedAt: string;
}

export interface ApprovalQueueOptions {
  /**
   * How long a request waits before being denied automatically.
   *
   * A pending approval holds an agent run open, so an unanswered one must not
   * hold it forever. Timing out denies rather than approves: the whole point of
   * the gate is that silence is not consent.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Bridges the agent's synchronous `Approver` to an out-of-band human decision.
 *
 * The agent awaits a promise; the dashboard resolves it over HTTP. Nothing here
 * is persistent - a restart denies everything in flight, which is the safe
 * direction.
 */
export class ApprovalQueue {
  private readonly waiting = new Map<
    string,
    { request: PendingApproval; settle: (decision: ApprovalDecision) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly history: ResolvedApproval[] = [];
  private readonly timeoutMs: number;

  constructor(options: ApprovalQueueOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Pass to `Agent` as its approver, optionally tagged with a trace id. */
  approver(traceId?: string): Approver {
    return async (call: ToolCall) => (await this.request(call, traceId)) === "approved";
  }

  request(call: ToolCall, traceId?: string): Promise<ApprovalDecision> {
    const request: PendingApproval = {
      id: randomUUID(),
      traceId,
      toolName: call.name,
      args: call.args,
      requestedAt: new Date().toISOString(),
    };

    return new Promise<ApprovalDecision>((resolve) => {
      const settle = (decision: ApprovalDecision) => {
        const entry = this.waiting.get(request.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.waiting.delete(request.id);
        this.history.unshift({ ...request, decision, decidedAt: new Date().toISOString() });
        resolve(decision);
      };

      const timer = setTimeout(() => settle("expired"), this.timeoutMs);
      // Do not keep the process alive purely to wait for an approval.
      timer.unref?.();
      this.waiting.set(request.id, { request, settle, timer });
    });
  }

  /** Oldest first: a queue a human works through top to bottom. */
  pending(): PendingApproval[] {
    return [...this.waiting.values()]
      .map((entry) => entry.request)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  resolved(limit = 50): ResolvedApproval[] {
    return this.history.slice(0, limit);
  }

  /** Returns false when the id is unknown or already decided. */
  decide(id: string, decision: Exclude<ApprovalDecision, "expired">): boolean {
    const entry = this.waiting.get(id);
    if (!entry) return false;
    entry.settle(decision);
    return true;
  }

  /** Denies everything in flight, for shutdown. */
  denyAll(): number {
    const count = this.waiting.size;
    for (const entry of [...this.waiting.values()]) entry.settle("denied");
    return count;
  }
}

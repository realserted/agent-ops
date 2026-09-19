import { Agent, ToolRegistry, type AgentEvent } from "@agent-ops/core";
import { ApprovalQueue } from "@agent-ops/approvals";
import { dashboardProvider } from "./provider";
import {
  createOperationsTools,
  FixtureInbox,
  InMemoryOperationsStore,
  SYSTEM_PROMPT,
} from "@agent-ops/tools";
import { InMemoryTraceStore, startTrace, type TraceStore } from "@agent-ops/tracing";

/**
 * Process-wide singletons.
 *
 * The approval queue holds promises an agent run is blocked on, so it cannot be
 * rebuilt per request — a new instance would orphan every waiting run. Next's
 * dev server re-evaluates modules on change, so they hang off globalThis to
 * survive that.
 */
interface Runtime {
  approvals: ApprovalQueue;
  traces: TraceStore;
  store: InMemoryOperationsStore;
  running: Set<string>;
}

const KEY = Symbol.for("agent-ops.dashboard.runtime");
const globalRef = globalThis as unknown as { [KEY]?: Runtime };

const freshRuntime = (): Runtime => ({
  approvals: new ApprovalQueue({ timeoutMs: 5 * 60 * 1000 }),
  traces: new InMemoryTraceStore(),
  store: new InMemoryOperationsStore(),
  running: new Set<string>(),
});

export function runtime(): Runtime {
  globalRef[KEY] ??= freshRuntime();
  return globalRef[KEY];
}

/**
 * Clears all state between end-to-end tests.
 *
 * The queue and the runs list are process-wide, so without this one test's
 * leftover approval blocks the next test's run from ever finishing, and "the
 * first pending item" may belong to a run the test did not start.
 *
 * Denies everything in flight first, so the agent runs those tests started
 * unblock and exit rather than being stranded on a promise nothing will
 * resolve.
 */
export function resetRuntime(): void {
  globalRef[KEY]?.approvals.denyAll();
  globalRef[KEY] = freshRuntime();
}

const ADVERSARIAL_FIXTURE = new URL(
  "../../../../packages/tools/fixtures/adversarial-emails.json",
  import.meta.url,
);

/**
 * The inbox a run reads.
 *
 * In test mode the adversarial fixtures are loaded alongside the benign ones,
 * so the end-to-end tests have an email that actually carries an injection.
 * The demo inbox deliberately does not: its phishing message targets a human
 * reader and raises no guardrail, which is correct but untestable.
 */
async function loadInbox(): Promise<FixtureInbox> {
  const benign = await FixtureInbox.fromFile();
  if (process.env.AGENT_OPS_TEST_PROVIDER !== "scripted") return benign;

  const adversarial = await FixtureInbox.fromFile(ADVERSARIAL_FIXTURE);
  return new FixtureInbox([...(await benign.list(50)), ...(await adversarial.list(50))]);
}

export interface StartRunResult {
  traceId: string;
}

/**
 * Starts a triage run in the background and returns its trace id immediately.
 *
 * The run blocks on human approvals, so awaiting it here would hold the HTTP
 * response open until someone clicked a button in the UI that this response has
 * not yet rendered.
 */
export async function startRun(task: string): Promise<StartRunResult> {
  const { approvals, traces, store, running } = runtime();
  const llm = dashboardProvider();
  const inbox = await loadInbox();

  const trace = await startTrace(traces, { provider: llm.name, model: llm.model, task });
  running.add(trace.traceId);

  const agent = new Agent({
    llm,
    tools: new ToolRegistry(createOperationsTools({ inbox, store })),
    systemPrompt: SYSTEM_PROMPT,
    approve: approvals.approver(trace.traceId),
    onEvent: (event: AgentEvent) => trace.record(event),
  });

  void agent
    .run(task)
    .then(async (result) => {
      await trace.finish(result);
    })
    .catch(async (error: unknown) => {
      await trace.fail(error);
    })
    .finally(() => {
      running.delete(trace.traceId);
    });

  return { traceId: trace.traceId };
}

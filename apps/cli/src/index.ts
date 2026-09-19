import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { Agent, ToolRegistry, type AgentEvent, type Approver } from "@agent-ops/core";
import { createProvider } from "@agent-ops/llm";
import { createOperationsTools, FixtureInbox, InMemoryOperationsStore } from "@agent-ops/tools";
import { InMemoryTraceStore, startTrace } from "@agent-ops/tracing";
import { DEFAULT_TASK, SYSTEM_PROMPT } from "./config";
import { printEvent, printSummary } from "./output";

function loadEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    // No .env file: rely on variables already set in the shell.
  }
}

const createTerminalApprover = (rl: readline.Interface): Approver => async (call) => {
  const answer = await rl.question(`\n  Approve ${call.name} ${JSON.stringify(call.args)}? [y/N] `);
  return answer.trim().toLowerCase() === "y";
};

async function main(): Promise<void> {
  loadEnv();
  const task = process.argv.slice(2).join(" ") || DEFAULT_TASK;
  const llm = createProvider();
  const store = new InMemoryOperationsStore();
  const inbox = await FixtureInbox.fromFile();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // In-memory for the terminal runner: a run's trace is worth seeing while it
  // happens, but persisting it needs a database the CLI should not require.
  // Swap in MongoTraceStore at this line to persist - see packages/tracing.
  const traces = new InMemoryTraceStore();
  const trace = await startTrace(traces, { provider: llm.name, model: llm.model, task });

  console.log(`Provider: ${llm.name} (${llm.model})\nTask: ${task}\nTrace: ${trace.traceId}`);

  try {
    const agent = new Agent({
      llm,
      tools: new ToolRegistry(createOperationsTools({ inbox, store })),
      systemPrompt: SYSTEM_PROMPT,
      approve: createTerminalApprover(rl),
      onEvent: (event: AgentEvent) => {
        printEvent(event);
        trace.record(event);
      },
    });

    const result = await agent.run(task);
    const traced = await trace.finish(result);
    printSummary(result, traced.cost);
    console.log(
      `\nStore: ${store.records.length} records, ${store.drafts.length} drafts, ${store.flags.length} flags`,
    );
  } catch (error) {
    await trace.fail(error);
    throw error;
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

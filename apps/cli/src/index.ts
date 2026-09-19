import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { Agent, ToolRegistry, type Approver } from "@agent-ops/core";
import { createProvider } from "@agent-ops/llm";
import { createOperationsTools, FixtureInbox, InMemoryOperationsStore } from "@agent-ops/tools";
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

  console.log(`Provider: ${llm.name} (${llm.model})\nTask: ${task}`);

  try {
    const agent = new Agent({
      llm,
      tools: new ToolRegistry(createOperationsTools({ inbox, store })),
      systemPrompt: SYSTEM_PROMPT,
      approve: createTerminalApprover(rl),
      onEvent: printEvent,
    });
    printSummary(await agent.run(task));
    console.log(
      `\nStore: ${store.records.length} records, ${store.drafts.length} drafts, ${store.flags.length} flags`,
    );
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { Agent, ToolRegistry, type AgentEvent } from "@agent-ops/core";
import { createProvider } from "@agent-ops/llm";
import { createOperationsTools, FixtureInbox, InMemoryOperationsStore, SYSTEM_PROMPT } from "@agent-ops/tools";
import {
  ADVERSARIAL_CASES,
  formatMarkdown,
  formatText,
  gradeCase,
  summarise,
  type CaseResult,
} from "@agent-ops/evals";


const ROOT = new URL("../../../", import.meta.url);
const ADVERSARIAL_FIXTURE = new URL("packages/tools/fixtures/adversarial-emails.json", ROOT);
const BENIGN_FIXTURE = new URL("packages/tools/fixtures/emails.json", ROOT);
const REPORT_DIR = new URL("docs/evals/", ROOT);

function loadEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL(".env", ROOT)));
  } catch {
    // No .env file: rely on variables already set in the shell.
  }
}

/**
 * Runs one adversarial email alongside the benign inbox.
 *
 * Approvals are granted automatically. That is deliberate: the approval gate
 * is already proven by the scripted tests, and denying here would make every
 * "no records created" check pass without telling us anything about the model.
 * Approving simulates an inattentive human and measures what the model itself
 * chose to attempt.
 */
async function runCase(emailId: string) {
  const [adversarial, benign] = await Promise.all([
    FixtureInbox.fromFile(ADVERSARIAL_FIXTURE),
    FixtureInbox.fromFile(BENIGN_FIXTURE),
  ]);
  const attackEmail = await adversarial.get(emailId);
  if (!attackEmail) throw new Error(`Fixture is missing ${emailId}`);

  const store = new InMemoryOperationsStore();
  const events: AgentEvent[] = [];
  const agent = new Agent({
    llm: createProvider(),
    tools: new ToolRegistry(
      createOperationsTools({ inbox: new FixtureInbox([attackEmail, ...(await benign.list(50))]), store }),
    ),
    systemPrompt: SYSTEM_PROMPT,
    approve: async () => true,
    onEvent: (event) => events.push(event),
  });

  return { store, result: await agent.run("Triage the inbox."), events };
}

async function main(): Promise<void> {
  loadEnv();
  const llm = createProvider();
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const cases = only.length ? ADVERSARIAL_CASES.filter((c) => only.includes(c.id)) : ADVERSARIAL_CASES;

  if (cases.length === 0) {
    throw new Error(`No cases matched. Known ids: ${ADVERSARIAL_CASES.map((c) => c.id).join(", ")}`);
  }

  console.log(`Running ${cases.length} adversarial case(s) against ${llm.name} (${llm.model})\n`);

  const results: CaseResult[] = [];
  for (const testCase of cases) {
    process.stdout.write(`  ${testCase.id}... `);
    try {
      const outcome = await runCase(testCase.emailId);
      const graded = gradeCase(testCase, outcome);
      results.push(graded);
      console.log(graded.passed ? "pass" : "FAIL");
    } catch (error) {
      // A transport failure is not a model failure; record it and keep going
      // so one flaky call does not discard the whole run.
      results.push({
        id: testCase.id,
        attack: testCase.attack,
        passed: false,
        checks: [],
        steps: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        error: error instanceof Error ? error.message : String(error),
      });
      console.log("ERROR");
    }
  }

  const board = summarise(`${llm.name}/${llm.model}`, results);
  console.log(`\n${formatText(board)}`);

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(new URL("SCOREBOARD.md", REPORT_DIR), `${formatMarkdown(board)}\n`, "utf8");
  console.log(`Scoreboard written to docs/evals/SCOREBOARD.md`);

  if (board.passed < board.total) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

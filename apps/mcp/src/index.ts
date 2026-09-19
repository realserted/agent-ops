import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOperationsTools, FixtureInbox, InMemoryOperationsStore } from "@agent-ops/tools";
import { createMcpServer } from "./server";

/**
 * Exposes the operations tools over MCP on stdio.
 *
 * Nothing may be written to stdout except protocol frames - stdio is the
 * transport. Diagnostics go to stderr.
 */
async function main(): Promise<void> {
  const inbox = await FixtureInbox.fromFile();
  const store = new InMemoryOperationsStore();
  const allowWrites = process.env.MCP_WRITE_TOOLS === "true";

  const server = createMcpServer({
    tools: createOperationsTools({ inbox, store }),
    allowWrites,
  });

  console.error(
    `agent-ops MCP server ready (write tools ${allowWrites ? "enabled" : "disabled"}; ` +
      "set MCP_WRITE_TOOLS=true to enable)",
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

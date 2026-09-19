import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapUntrusted, type Tool, type ToolContext } from "@agent-ops/core";

export interface McpServerOptions {
  tools: Tool[];
  /**
   * Expose tools that write. Off by default: an MCP host calls tools on the
   * model's say-so, and this project's rule is that approval is deny-by-default.
   * The operator opts in once they have decided their host's approval prompt is
   * a sufficient gate.
   */
  allowWrites?: boolean;
  context?: ToolContext;
}

/** Tools whose output leaves the system and therefore needs an explicit opt-in. */
const isWriteTool = (tool: Tool): boolean => tool.name !== "list_emails" && tool.name !== "get_email";

export function selectTools(tools: Tool[], allowWrites: boolean): Tool[] {
  return allowWrites ? tools : tools.filter((tool) => !isWriteTool(tool));
}

/**
 * Describes a tool to an MCP host.
 *
 * `requiresApproval` has no MCP equivalent, so it is surfaced twice: in the
 * annotations the host uses to decide whether to prompt, and in the description
 * the model reads. Neither is a control - the host's own approval prompt is.
 */
export function describe(tool: Tool): { description: string; annotations: Record<string, boolean> } {
  const write = isWriteTool(tool);
  const description = tool.requiresApproval
    ? `${tool.description} A human must approve this call before it takes effect.`
    : tool.description;

  return {
    description,
    annotations: {
      readOnlyHint: !write,
      destructiveHint: false,
      idempotentHint: !write,
      openWorldHint: false,
    },
  };
}

export interface McpToolResult {
  /** The SDK's CallToolResult is open-ended; the index signature keeps this assignable to it. */
  [key: string]: unknown;
  isError?: boolean;
  content: { type: "text"; text: string }[];
}

const text = (value: string): McpToolResult["content"] => [{ type: "text", text: value }];

/**
 * Runs one tool and shapes the result for MCP.
 *
 * Exported so the behaviour can be tested directly rather than through the
 * SDK's private registry. Never throws: a failure is reported to the host as
 * an error result, matching how the agent loop treats tool failures.
 */
export async function invokeTool(
  tool: Tool,
  args: unknown,
  context: ToolContext,
): Promise<McpToolResult> {
  try {
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) return { isError: true, content: text(`Invalid arguments: ${parsed.error.message}`) };

    const output = await tool.execute(parsed.data, context);
    // Email content reaching an MCP host is third-party text exactly as it is
    // inside the agent, so it carries the same boundary marking.
    const payload = tool.untrustedOutput ? wrapUntrusted(output) : output;
    return { content: text(JSON.stringify(payload)) };
  } catch (error) {
    return { isError: true, content: text(error instanceof Error ? error.message : String(error)) };
  }
}

export function createMcpServer({ tools, allowWrites = false, context }: McpServerOptions): McpServer {
  const server = new McpServer({ name: "agent-ops", version: "0.1.0" });
  const toolContext: ToolContext = context ?? { runId: `mcp-${Date.now()}` };

  for (const tool of selectTools(tools, allowWrites)) {
    const { description, annotations } = describe(tool);

    server.registerTool(
      tool.name,
      { description, annotations, inputSchema: (tool.schema as unknown as z.ZodObject<z.ZodRawShape>).shape },
      async (args: Record<string, unknown>) => invokeTool(tool, args, toolContext),
    );
  }

  return server;
}

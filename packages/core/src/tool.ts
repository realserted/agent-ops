import { z } from "zod";
import type { JsonSchema, ToolDefinition } from "@agent-ops/llm";

export interface ToolContext {
  runId: string;
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Irreversible or externally visible actions must be approved by a human. */
  requiresApproval?: boolean;
  /**
   * Output originates outside the system (email bodies, senders, subjects).
   * The agent wraps it in an untrusted-content envelope before the model
   * sees it, and scans it for injection patterns.
   */
  untrustedOutput?: boolean;
  execute(args: z.infer<S>, context: ToolContext): Promise<unknown>;
}

/** Identity helper that infers `args` types from the Zod schema. */
export const defineTool = <S extends z.ZodType>(tool: Tool<S>): Tool<S> => tool;

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly toolDefinitions: ToolDefinition[];

  constructor(tools: Tool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
    this.toolDefinitions = tools.map(toDefinition);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return this.toolDefinitions;
  }
}

function toDefinition({ name, description, schema }: Tool): ToolDefinition {
  const { $schema: _, ...parameters } = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  return { name, description, parameters };
}

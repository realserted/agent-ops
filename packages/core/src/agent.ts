import { randomUUID } from "node:crypto";
import type { LLMProvider, Message, TokenUsage, ToolCall, ToolResult } from "@agent-ops/llm";
import type { ToolContext, ToolRegistry } from "./tool";

const DEFAULT_MAX_STEPS = 15;

export type AgentEvent =
  | { type: "llm_response"; step: number; content: string; toolCalls: ToolCall[]; usage: TokenUsage; durationMs: number }
  | { type: "tool_result"; step: number; result: ToolResult; durationMs: number };

/** Resolves to true when a human approves the tool call. */
export type Approver = (call: ToolCall) => Promise<boolean>;

export interface AgentConfig {
  llm: LLMProvider;
  tools: ToolRegistry;
  systemPrompt: string;
  maxSteps?: number;
  /** Without an approver, every approval-gated tool call is denied. */
  approve?: Approver;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  runId: string;
  status: "completed" | "max_steps";
  output: string;
  steps: number;
  usage: TokenUsage;
  messages: Message[];
}

export class Agent {
  constructor(private readonly config: AgentConfig) {}

  async run(input: string): Promise<AgentRunResult> {
    const { llm, tools, systemPrompt, maxSteps = DEFAULT_MAX_STEPS, onEvent } = this.config;
    const context: ToolContext = { runId: randomUUID() };
    const messages: Message[] = [{ role: "user", content: input }];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const finish = (status: AgentRunResult["status"], output: string, steps: number): AgentRunResult => ({
      runId: context.runId, status, output, steps, usage, messages,
    });

    for (let step = 1; step <= maxSteps; step++) {
      const startedAt = performance.now();
      const response = await llm.generate({ system: systemPrompt, messages, tools: tools.definitions() });
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;

      messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls, raw: response.raw });
      onEvent?.({
        type: "llm_response", step, content: response.content, toolCalls: response.toolCalls,
        usage: response.usage, durationMs: performance.now() - startedAt,
      });

      if (response.toolCalls.length === 0) return finish("completed", response.content, step);

      // Sequential on purpose: approvals prompt one at a time and tools may depend on earlier writes.
      const results: ToolResult[] = [];
      for (const call of response.toolCalls) {
        const toolStartedAt = performance.now();
        const result = await this.invokeTool(call, context);
        onEvent?.({ type: "tool_result", step, result, durationMs: performance.now() - toolStartedAt });
        results.push(result);
      }
      messages.push({ role: "tool", results });
    }

    return finish("max_steps", "", maxSteps);
  }

  /** Never throws: failures go back to the model as error results so it can recover. */
  private async invokeTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const fail = (error: string): ToolResult => ({ callId: call.id, name: call.name, output: { error }, isError: true });

    const tool = this.config.tools.get(call.name);
    if (!tool) return fail(`Unknown tool "${call.name}".`);

    const parsed = tool.schema.safeParse(call.args);
    if (!parsed.success) return fail(`Invalid arguments: ${parsed.error.message}`);

    if (tool.requiresApproval && !(await this.config.approve?.(call))) {
      return fail("A human reviewer did not approve this action. Do not retry it; mention it in your summary.");
    }

    try {
      return { callId: call.id, name: call.name, output: await tool.execute(parsed.data, context), isError: false };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
}

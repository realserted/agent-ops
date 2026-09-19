import { randomUUID } from "node:crypto";
import type { LLMProvider, Message, TokenUsage, ToolCall, ToolResult } from "@agent-ops/llm";
import type { ToolContext, ToolRegistry } from "./tool";
import { checkBudgets, DEFAULT_LIMITS, type RunLimits } from "./guardrails/budgets";
import { detectInjection } from "./guardrails/injection";
import { LoopDetector } from "./guardrails/loop";
import { wrapUntrusted } from "./guardrails/untrusted";

export type AgentEvent =
  | { type: "llm_response"; step: number; content: string; toolCalls: ToolCall[]; usage: TokenUsage; durationMs: number }
  | { type: "tool_result"; step: number; result: ToolResult; durationMs: number }
  | { type: "guardrail"; step: number; tool: string; warnings: string[] };

/** Resolves to true when a human approves the tool call. */
export type Approver = (call: ToolCall) => Promise<boolean>;

export interface AgentConfig extends Partial<RunLimits> {
  llm: LLMProvider;
  tools: ToolRegistry;
  systemPrompt: string;
  /** Without an approver, every approval-gated tool call is denied. */
  approve?: Approver;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunOptions {
  /** When set, only these tools may be called. Anything else returns an error result. */
  allowedTools?: string[];
}

export interface AgentRunResult {
  runId: string;
  status: "completed" | "max_steps" | "budget_exceeded";
  output: string;
  steps: number;
  usage: TokenUsage;
  messages: Message[];
}

export class Agent {
  constructor(private readonly config: AgentConfig) {}

  async run(input: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const { llm, tools, systemPrompt, onEvent } = this.config;
    const limits: RunLimits = { ...DEFAULT_LIMITS, ...stripUndefined(this.config) };
    const context: ToolContext = { runId: randomUUID() };
    const messages: Message[] = [{ role: "user", content: input }];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const loops = new LoopDetector();
    let toolCalls = 0;

    const finish = (status: AgentRunResult["status"], output: string, steps: number): AgentRunResult => ({
      runId: context.runId, status, output, steps, usage, messages,
    });

    for (let step = 1; step <= limits.maxSteps; step++) {
      const spend = { toolCalls, totalTokens: usage.inputTokens + usage.outputTokens };
      const exhausted = checkBudgets(spend, limits);
      if (exhausted) return finish("budget_exceeded", exhausted, step - 1);

      const startedAt = performance.now();
      const response = await llm.generate({
        system: systemPrompt,
        messages,
        tools: tools.definitions(),
        timeoutMs: limits.llmTimeoutMs,
      });
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
        const result = await this.invokeTool(call, context, { limits, loops, allowedTools: options.allowedTools });
        toolCalls += 1;

        if (result.warnings?.length) {
          onEvent?.({ type: "guardrail", step, tool: call.name, warnings: result.warnings });
        }
        onEvent?.({ type: "tool_result", step, result, durationMs: performance.now() - toolStartedAt });
        results.push(result);
      }
      messages.push({ role: "tool", results });
    }

    return finish("max_steps", "", limits.maxSteps);
  }

  /** Never throws: failures go back to the model as error results so it can recover. */
  private async invokeTool(
    call: ToolCall,
    context: ToolContext,
    run: { limits: RunLimits; loops: LoopDetector; allowedTools?: string[] },
  ): Promise<ToolResult> {
    const fail = (error: string): ToolResult => ({ callId: call.id, name: call.name, output: { error }, isError: true });

    if (run.allowedTools && !run.allowedTools.includes(call.name)) {
      return fail(`Tool "${call.name}" is not available in this run.`);
    }

    const tool = this.config.tools.get(call.name);
    if (!tool) return fail(`Unknown tool "${call.name}".`);

    const parsed = tool.schema.safeParse(call.args);
    if (!parsed.success) return fail(`Invalid arguments: ${parsed.error.message}`);

    const looping = run.loops.record(call.name, call.args);
    if (looping) return fail(looping);

    if (tool.requiresApproval && !(await this.config.approve?.(call))) {
      return fail("A human reviewer did not approve this action. Do not retry it; mention it in your summary.");
    }

    try {
      const output = await withTimeout(
        tool.execute(parsed.data, context),
        run.limits.toolTimeoutMs,
        `Tool "${call.name}" timed out after ${run.limits.toolTimeoutMs}ms.`,
      );
      if (!tool.untrustedOutput) {
        return { callId: call.id, name: call.name, output, isError: false };
      }

      const wrapped = wrapUntrusted(output);
      const warnings = detectInjection(JSON.stringify(output) ?? "");
      return { callId: call.id, name: call.name, output: wrapped, isError: false, ...(warnings.length && { warnings }) };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
}

/** Limit overrides arrive mixed into AgentConfig; undefined must not clobber a default. */
function stripUndefined(config: AgentConfig): Partial<RunLimits> {
  const keys = Object.keys(DEFAULT_LIMITS) as (keyof RunLimits)[];
  return Object.fromEntries(
    keys.flatMap((key) => (config[key] === undefined ? [] : [[key, config[key]]])),
  ) as Partial<RunLimits>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

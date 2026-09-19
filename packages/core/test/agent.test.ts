import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { GenerateResponse, ToolCall } from "@agent-ops/llm";
import { Agent, defineTool, ToolRegistry } from "../src/index";
import { ScriptedProvider } from "./helpers/scripted-provider";

const usage = { inputTokens: 10, outputTokens: 5 };
const callTool = (name: string, args: Record<string, unknown>): GenerateResponse => ({
  content: "", toolCalls: [{ id: `call_${name}`, name, args }], usage,
});
const answer = (content: string): GenerateResponse => ({ content, toolCalls: [], usage });

const addTool = defineTool({
  name: "add",
  description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => ({ sum: a + b }),
});

const deleteTool = defineTool({
  name: "delete_everything",
  description: "Dangerous",
  schema: z.object({}),
  requiresApproval: true,
  execute: async () => ({ deleted: true }),
});

const buildAgent = (responses: GenerateResponse[], approve?: (call: ToolCall) => Promise<boolean>) =>
  new Agent({
    llm: new ScriptedProvider(responses),
    tools: new ToolRegistry([addTool, deleteTool]),
    systemPrompt: "test",
    maxSteps: 3,
    approve,
  });

const toolOutputs = (result: Awaited<ReturnType<Agent["run"]>>) =>
  result.messages.flatMap((m) => (m.role === "tool" ? m.results : []));

describe("Agent", () => {
  it("executes a tool, feeds the result back, and returns the final answer", async () => {
    const result = await buildAgent([callTool("add", { a: 2, b: 3 }), answer("The sum is 5")]).run("2+3?");

    expect(result.status).toBe("completed");
    expect(result.output).toBe("The sum is 5");
    expect(result.steps).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(toolOutputs(result)[0]?.output).toEqual({ sum: 5 });
  });

  it("returns validation errors to the model instead of throwing", async () => {
    const result = await buildAgent([callTool("add", { a: "two" }), answer("done")]).run("x");
    const [toolResult] = toolOutputs(result);

    expect(toolResult?.isError).toBe(true);
    expect(JSON.stringify(toolResult?.output)).toMatch(/Invalid arguments/);
  });

  it("denies approval-gated tools when no approver is configured", async () => {
    const result = await buildAgent([callTool("delete_everything", {}), answer("skipped")]).run("x");

    expect(toolOutputs(result)[0]?.isError).toBe(true);
  });

  it("runs approval-gated tools once approved", async () => {
    const result = await buildAgent([callTool("delete_everything", {}), answer("done")], async () => true).run("x");

    expect(toolOutputs(result)[0]?.output).toEqual({ deleted: true });
  });

  it("stops at maxSteps when the model never finishes", async () => {
    const loop = Array.from({ length: 3 }, () => callTool("add", { a: 1, b: 1 }));
    const result = await buildAgent(loop).run("x");

    expect(result.status).toBe("max_steps");
    expect(result.steps).toBe(3);
  });
});

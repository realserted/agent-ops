import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import type { GenerateResponse, LLMProvider, ToolCall } from "@agent-ops/llm";
import { Agent, defineTool, ToolRegistry } from "../src/index";

/** Replays a fixed sequence of responses so the loop can be tested offline. */
class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  readonly model = "test";
  constructor(private readonly responses: GenerateResponse[]) {}
  async generate(): Promise<GenerateResponse> {
    const next = this.responses.shift();
    if (!next) throw new Error("ScriptedProvider ran out of responses");
    return next;
  }
}

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

    assert.equal(result.status, "completed");
    assert.equal(result.output, "The sum is 5");
    assert.equal(result.steps, 2);
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 });
    assert.deepEqual(toolOutputs(result)[0]?.output, { sum: 5 });
  });

  it("returns validation errors to the model instead of throwing", async () => {
    const result = await buildAgent([callTool("add", { a: "two" }), answer("done")]).run("x");
    const [toolResult] = toolOutputs(result);

    assert.equal(toolResult?.isError, true);
    assert.match(JSON.stringify(toolResult?.output), /Invalid arguments/);
  });

  it("denies approval-gated tools when no approver is configured", async () => {
    const result = await buildAgent([callTool("delete_everything", {}), answer("skipped")]).run("x");

    assert.equal(toolOutputs(result)[0]?.isError, true);
  });

  it("runs approval-gated tools once approved", async () => {
    const result = await buildAgent([callTool("delete_everything", {}), answer("done")], async () => true).run("x");

    assert.deepEqual(toolOutputs(result)[0]?.output, { deleted: true });
  });

  it("stops at maxSteps when the model never finishes", async () => {
    const loop = Array.from({ length: 3 }, () => callTool("add", { a: 1, b: 1 }));
    const result = await buildAgent(loop).run("x");

    assert.equal(result.status, "max_steps");
    assert.equal(result.steps, 3);
  });
});

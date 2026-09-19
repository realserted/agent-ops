import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { GenerateResponse, ToolCall } from "@agent-ops/llm";
import { Agent, type AgentEvent, defineTool, ToolRegistry } from "../src/index";
import { answer, callTool, callTools, ScriptedProvider } from "./helpers/scripted-provider";

const addTool = defineTool({
  name: "add",
  description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => ({ sum: a + b }),
});

const explodeTool = defineTool({
  name: "explode",
  description: "Always throws",
  schema: z.object({}),
  execute: async () => {
    throw new Error("boom");
  },
});

const deleteTool = defineTool({
  name: "delete_everything",
  description: "Dangerous",
  schema: z.object({}),
  requiresApproval: true,
  execute: async () => ({ deleted: true }),
});

const buildAgent = (
  responses: GenerateResponse[],
  approve?: (call: ToolCall) => Promise<boolean>,
  onEvent?: (event: AgentEvent) => void,
) =>
  new Agent({
    llm: new ScriptedProvider(responses),
    tools: new ToolRegistry([addTool, deleteTool, explodeTool]),
    systemPrompt: "test",
    maxSteps: 3,
    approve,
    onEvent,
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

  it("turns a throwing tool into an error result instead of failing the run", async () => {
    const result = await buildAgent([callTool("explode", {}), answer("recovered")]).run("x");

    expect(toolOutputs(result)[0]).toMatchObject({ isError: true, output: { error: "boom" } });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("recovered");
  });

  it("returns an error for an unknown tool name", async () => {
    const result = await buildAgent([callTool("no_such_tool", {}), answer("done")]).run("x");
    const [toolResult] = toolOutputs(result);

    expect(toolResult?.isError).toBe(true);
    expect(toolResult?.output).toEqual({ error: 'Unknown tool "no_such_tool".' });
  });

  it("accumulates usage across every step", async () => {
    const result = await buildAgent([
      callTool("add", { a: 1, b: 1 }),
      callTool("add", { a: 2, b: 2 }),
      answer("done"),
    ]).run("x");

    expect(result.steps).toBe(3);
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 15 });
  });

  it("emits each step's llm_response before its tool results, in call order", async () => {
    const events: AgentEvent[] = [];
    await buildAgent(
      [
        callTools([
          { name: "add", args: { a: 1, b: 1 } },
          { name: "add", args: { a: 2, b: 2 } },
        ]),
        answer("done"),
      ],
      undefined,
      (event) => events.push(event),
    ).run("x");

    expect(events.map((e) => `${e.type}:${e.step}`)).toEqual([
      "llm_response:1",
      "tool_result:1",
      "tool_result:1",
      "llm_response:2",
    ]);
    const sums = events.flatMap((e) => (e.type === "tool_result" ? [e.result.output] : []));
    expect(sums).toEqual([{ sum: 2 }, { sum: 4 }]);
  });
});

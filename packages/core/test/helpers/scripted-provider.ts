import type { GenerateResponse, LLMProvider } from "@agent-ops/llm";

/** Replays a fixed sequence of responses so the loop can be tested offline. */
export class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  readonly model = "test";
  constructor(private readonly responses: GenerateResponse[]) {}
  async generate(): Promise<GenerateResponse> {
    const next = this.responses.shift();
    if (!next) throw new Error("ScriptedProvider ran out of responses");
    return next;
  }
}

const DEFAULT_USAGE = { inputTokens: 10, outputTokens: 5 };

/** A turn in which the model calls one tool. */
export const callTool = (
  name: string,
  args: Record<string, unknown>,
  usage = DEFAULT_USAGE,
): GenerateResponse => ({
  content: "",
  toolCalls: [{ id: `call_${name}`, name, args }],
  usage,
});

/** A turn in which the model calls several tools at once. */
export const callTools = (
  calls: { name: string; args: Record<string, unknown> }[],
  usage = DEFAULT_USAGE,
): GenerateResponse => ({
  content: "",
  toolCalls: calls.map(({ name, args }, index) => ({ id: `call_${name}_${index}`, name, args })),
  usage,
});

/** A final turn with no tool calls, which ends the run. */
export const answer = (content: string, usage = DEFAULT_USAGE): GenerateResponse => ({
  content,
  toolCalls: [],
  usage,
});

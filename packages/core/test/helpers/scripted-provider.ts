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

import { postJson } from "./http";
import type { GenerateRequest, GenerateResponse, LLMProvider, Message } from "./types";

const PROVIDER = "anthropic";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface AnthropicResponse {
  content: ContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = PROVIDER;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly maxTokens = 4096,
  ) {}

  async generate({ system, messages, tools }: GenerateRequest): Promise<GenerateResponse> {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: messages.map(toAnthropicMessage),
      ...(tools.length > 0 && {
        tools: tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })),
      }),
    };

    const data = await postJson<AnthropicResponse>(API_URL, body, {
      headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
    });

    return {
      content: data.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
      toolCalls: data.content.flatMap((b) =>
        b.type === "tool_use" ? [{ id: b.id, name: b.name, args: b.input }] : [],
      ),
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
      raw: { provider: PROVIDER, data: data.content },
    };
  }
}

function toAnthropicMessage(message: Message): AnthropicMessage {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      if (message.raw?.provider === PROVIDER) {
        return { role: "assistant", content: message.raw.data as ContentBlock[] };
      }
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.toolCalls.map(({ id, name, args }) => ({ type: "tool_use" as const, id, name, input: args })),
        ],
      };
    case "tool":
      return {
        role: "user",
        content: message.results.map(({ callId, output, isError }) => ({
          type: "tool_result" as const,
          tool_use_id: callId,
          content: JSON.stringify(output),
          is_error: isError,
        })),
      };
  }
}

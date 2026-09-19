import { randomUUID } from "node:crypto";
import { postJson, toJsonObject } from "./http";
import type {
  GenerateRequest,
  GenerateResponse,
  JsonSchema,
  LLMProvider,
  Message,
  ToolDefinition,
} from "./types";

const PROVIDER = "gemini";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Gemini accepts an OpenAPI subset of JSON Schema; anything else is dropped. */
const ALLOWED_SCHEMA_KEYS = new Set([
  "type", "description", "properties", "required", "items", "enum",
  "format", "nullable", "minimum", "maximum", "minItems", "maxItems",
]);

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: unknown;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiProvider implements LLMProvider {
  readonly name = PROVIDER;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate({ system, messages, tools }: GenerateRequest): Promise<GenerateResponse> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(toGeminiContent),
      ...(tools.length > 0 && { tools: [{ functionDeclarations: tools.map(toFunctionDeclaration) }] }),
    };

    const data = await postJson<GeminiResponse>(`${BASE_URL}/${this.model}:generateContent`, body, {
      headers: { "x-goog-api-key": this.apiKey },
    });

    const content = data.candidates?.[0]?.content;
    if (!content) {
      throw new Error(`Gemini returned no content: ${JSON.stringify(data.promptFeedback ?? data)}`);
    }
    const parts = content.parts ?? [];

    return {
      content: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(""),
      toolCalls: parts.flatMap(({ functionCall: call }) =>
        call ? [{ id: call.id ?? randomUUID(), name: call.name, args: call.args ?? {} }] : [],
      ),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      raw: { provider: PROVIDER, data: content },
    };
  }
}

function toGeminiContent(message: Message): GeminiContent {
  switch (message.role) {
    case "user":
      return { role: "user", parts: [{ text: message.content }] };
    case "assistant":
      if (message.raw?.provider === PROVIDER) return message.raw.data as GeminiContent;
      return {
        role: "model",
        parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...message.toolCalls.map(({ name, args }) => ({ functionCall: { name, args } })),
        ],
      };
    case "tool":
      return {
        role: "user",
        parts: message.results.map(({ name, output }) => ({
          functionResponse: { name, response: toJsonObject(output) },
        })),
      };
  }
}

function toFunctionDeclaration({ name, description, parameters }: ToolDefinition) {
  return { name, description, parameters: toGeminiSchema(parameters) };
}

function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) continue;
    if (key === "type") result.type = String(value).toUpperCase();
    else if (key === "items") result.items = toGeminiSchema(value as JsonSchema);
    else if (key === "properties") {
      result.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, toGeminiSchema(v)]),
      );
    } else result[key] = value;
  }
  return result;
}

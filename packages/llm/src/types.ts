export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: unknown;
  isError: boolean;
  /** Guardrail signals about this result. Advisory: they never imply an error. */
  warnings?: string[];
}

/**
 * Provider-native payload for an assistant turn. Echoed back verbatim to the
 * same provider so provider-specific fields (e.g. thought signatures) survive.
 */
export interface RawTurn {
  provider: string;
  data: unknown;
}

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[]; raw?: RawTurn }
  | { role: "tool"; results: ToolResult[] };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateRequest {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
}

export interface GenerateResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  raw?: RawTurn;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}

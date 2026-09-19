import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../src/anthropic";
import type { GenerateRequest } from "../src/types";

const reply = (body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

const textResponse = (text: string) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 12, output_tokens: 5 },
});

const generate = async (fetchMock: ReturnType<typeof vi.fn>, request: Partial<GenerateRequest> = {}) => {
  vi.stubGlobal("fetch", fetchMock);
  const provider = new AnthropicProvider("test-key", "claude-haiku-4-5");
  return provider.generate({ system: "sys", messages: [], tools: [], ...request });
};

const sentBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AnthropicProvider", () => {
  it("sends the api key and version headers with the configured model", async () => {
    const fetchMock = reply(textResponse("hi"));
    await generate(fetchMock);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2023-06-01" });
    expect(sentBody(fetchMock)).toMatchObject({ model: "claude-haiku-4-5", system: "sys" });
  });

  it("joins text blocks and maps tool_use blocks to tool calls", async () => {
    const response = await generate(
      reply({
        content: [
          { type: "text", text: "Let me " },
          { type: "text", text: "check." },
          { type: "tool_use", id: "tu_1", name: "get_email", input: { email_id: "em_001" } },
        ],
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    );

    expect(response.content).toBe("Let me check.");
    expect(response.toolCalls).toEqual([{ id: "tu_1", name: "get_email", args: { email_id: "em_001" } }]);
    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
  });

  it("omits tools from the request when none are supplied", async () => {
    const fetchMock = reply(textResponse("ok"));
    await generate(fetchMock);

    expect(sentBody(fetchMock)).not.toHaveProperty("tools");
  });

  it("renames tool parameters to input_schema when tools are supplied", async () => {
    const fetchMock = reply(textResponse("ok"));
    await generate(fetchMock, {
      tools: [{ name: "add", description: "Adds", parameters: { type: "object" } }],
    });

    expect(sentBody(fetchMock).tools).toEqual([
      { name: "add", description: "Adds", input_schema: { type: "object" } },
    ]);
  });

  it("maps tool results to tool_result blocks and preserves is_error", async () => {
    const fetchMock = reply(textResponse("ok"));
    await generate(fetchMock, {
      messages: [
        {
          role: "tool",
          results: [
            { callId: "tu_1", name: "add", output: { sum: 5 }, isError: false },
            { callId: "tu_2", name: "explode", output: { error: "boom" }, isError: true },
          ],
        },
      ],
    });

    expect(sentBody(fetchMock).messages[0]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_1", content: '{"sum":5}', is_error: false },
        { type: "tool_result", tool_use_id: "tu_2", content: '{"error":"boom"}', is_error: true },
      ],
    });
  });

  it("echoes an Anthropic assistant turn back verbatim", async () => {
    const raw = [{ type: "text", text: "earlier" }, { type: "tool_use", id: "tu_9", name: "add", input: {} }];
    const fetchMock = reply(textResponse("ok"));

    await generate(fetchMock, {
      messages: [
        { role: "assistant", content: "earlier", toolCalls: [], raw: { provider: "anthropic", data: raw } },
      ],
    });

    expect(sentBody(fetchMock).messages[0]).toEqual({ role: "assistant", content: raw });
  });

  it("rebuilds content blocks for an assistant turn from another provider", async () => {
    const fetchMock = reply(textResponse("ok"));

    await generate(fetchMock, {
      messages: [
        {
          role: "assistant",
          content: "hello",
          toolCalls: [{ id: "call_1", name: "add", args: { a: 1 } }],
          raw: { provider: "gemini", data: { ignored: true } },
        },
      ],
    });

    expect(sentBody(fetchMock).messages[0]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", id: "call_1", name: "add", input: { a: 1 } },
      ],
    });
  });

  it("passes a user turn through as plain string content", async () => {
    const fetchMock = reply(textResponse("ok"));
    await generate(fetchMock, { messages: [{ role: "user", content: "triage the inbox" }] });

    expect(sentBody(fetchMock).messages[0]).toEqual({ role: "user", content: "triage the inbox" });
  });
});

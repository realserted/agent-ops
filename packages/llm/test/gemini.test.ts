import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../src/gemini";
import type { GenerateRequest } from "../src/types";

const reply = (body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

const textResponse = (text: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
});

const generate = async (fetchMock: ReturnType<typeof vi.fn>, request: Partial<GenerateRequest> = {}) => {
  vi.stubGlobal("fetch", fetchMock);
  const provider = new GeminiProvider("test-key", "gemini-2.5-flash");
  return provider.generate({ system: "sys", messages: [], tools: [], ...request });
};

const sentBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GeminiProvider", () => {
  it("authenticates with the x-goog-api-key header and never a query param", async () => {
    const fetchMock = reply(textResponse("hi"));
    await generate(fetchMock);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(url).not.toContain("key=");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "test-key" });
  });

  it("reports usage and joins text parts, ignoring thought parts", async () => {
    const fetchMock = reply({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "thinking...", thought: true }, { text: "Hello " }, { text: "world" }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
    });

    const response = await generate(fetchMock);

    expect(response.content).toBe("Hello world");
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
  });

  it("defaults usage to zero when the response omits usageMetadata", async () => {
    const response = await generate(reply({ candidates: [{ content: { role: "model", parts: [] } }] }));

    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("maps function calls to tool calls, generating an id when absent", async () => {
    const fetchMock = reply({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { functionCall: { id: "fc_1", name: "get_email", args: { email_id: "em_001" } } },
              { functionCall: { name: "list_emails" } },
            ],
          },
        },
      ],
    });

    const response = await generate(fetchMock);

    expect(response.toolCalls[0]).toEqual({ id: "fc_1", name: "get_email", args: { email_id: "em_001" } });
    expect(response.toolCalls[1]?.name).toBe("list_emails");
    expect(response.toolCalls[1]?.args).toEqual({});
    expect(response.toolCalls[1]?.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("throws a descriptive error when there are no candidates", async () => {
    await expect(generate(reply({ promptFeedback: { blockReason: "SAFETY" } }))).rejects.toThrow(
      /Gemini returned no content.*SAFETY/s,
    );
  });

  it("echoes a Gemini assistant turn back verbatim", async () => {
    const raw = { role: "model", parts: [{ text: "earlier", thoughtSignature: "sig-123" }] };
    const fetchMock = reply(textResponse("ok"));

    await generate(fetchMock, {
      messages: [{ role: "assistant", content: "earlier", toolCalls: [], raw: { provider: "gemini", data: raw } }],
    });

    expect(sentBody(fetchMock).contents[0]).toEqual(raw);
  });

  it("rebuilds parts for an assistant turn from another provider", async () => {
    const fetchMock = reply(textResponse("ok"));

    await generate(fetchMock, {
      messages: [
        {
          role: "assistant",
          content: "hello",
          toolCalls: [{ id: "call_1", name: "add", args: { a: 1 } }],
          raw: { provider: "anthropic", data: { ignored: true } },
        },
      ],
    });

    expect(sentBody(fetchMock).contents[0]).toEqual({
      role: "model",
      parts: [{ text: "hello" }, { functionCall: { name: "add", args: { a: 1 } } }],
    });
  });

  it("sends tool results as functionResponse parts with non-object outputs wrapped", async () => {
    const fetchMock = reply(textResponse("ok"));

    await generate(fetchMock, {
      messages: [
        {
          role: "tool",
          results: [
            { callId: "c1", name: "add", output: { sum: 5 }, isError: false },
            { callId: "c2", name: "count", output: 7, isError: false },
          ],
        },
      ],
    });

    expect(sentBody(fetchMock).contents[0]).toEqual({
      role: "user",
      parts: [
        { functionResponse: { name: "add", response: { sum: 5 } } },
        { functionResponse: { name: "count", response: { result: 7 } } },
      ],
    });
  });

  it("omits tools from the request when none are supplied", async () => {
    const fetchMock = reply(textResponse("ok"));
    await generate(fetchMock);

    expect(sentBody(fetchMock)).not.toHaveProperty("tools");
  });

  describe("schema sanitizer", () => {
    const declarationFor = async (parameters: Record<string, unknown>) => {
      const fetchMock = reply(textResponse("ok"));
      await generate(fetchMock, {
        tools: [{ name: "t", description: "d", parameters }],
      });
      return sentBody(fetchMock).tools[0].functionDeclarations[0];
    };

    it("uppercases types and drops keys Gemini rejects", async () => {
      const declaration = await declarationFor({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        properties: { limit: { type: "number", default: 10, description: "How many" } },
        required: ["limit"],
      });

      expect(declaration.parameters).toEqual({
        type: "OBJECT",
        properties: { limit: { type: "NUMBER", description: "How many" } },
        required: ["limit"],
      });
    });

    it("recurses into array items", async () => {
      const declaration = await declarationFor({
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: { type: "object", additionalProperties: false, properties: { name: { type: "string" } } },
          },
        },
      });

      expect(declaration.parameters.properties.fields).toEqual({
        type: "ARRAY",
        items: { type: "OBJECT", properties: { name: { type: "STRING" } } },
      });
    });
  });
});

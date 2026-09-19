import { beforeEach, describe, expect, it } from "vitest";
import { UNTRUSTED_KEY, type Tool } from "@agent-ops/core";
import { createOperationsTools, FixtureInbox, InMemoryOperationsStore } from "@agent-ops/tools";
import { createMcpServer, describe as describeTool, invokeTool, selectTools } from "../src/server";

const CONTEXT = { runId: "mcp-test" };

let store: InMemoryOperationsStore;
let tools: Tool[];

const byName = (name: string): Tool => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
};

const call = (name: string, args: Record<string, unknown>) => invokeTool(byName(name), args, CONTEXT);

beforeEach(async () => {
  store = new InMemoryOperationsStore();
  tools = createOperationsTools({ inbox: await FixtureInbox.fromFile(), store });
});

describe("selectTools", () => {
  // Deny-by-default: an MCP host calls tools on the model's say-so, so the
  // writing tools need the operator to opt in.
  it("exposes only read tools by default", () => {
    expect(selectTools(tools, false).map((t) => t.name)).toEqual(["list_emails", "get_email"]);
  });

  it("exposes every tool once writes are enabled", () => {
    expect(selectTools(tools, true)).toHaveLength(5);
  });

  it("never exposes an approval-gated tool by accident", () => {
    for (const tool of selectTools(tools, false)) {
      expect(tool.requiresApproval, `${tool.name} is gated`).toBeUndefined();
    }
  });
});

describe("describe", () => {
  it("marks read tools as read-only for the host's prompt logic", () => {
    expect(describeTool(byName("get_email")).annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
  });

  it("marks writing tools as not read-only", () => {
    expect(describeTool(byName("draft_reply")).annotations).toMatchObject({ readOnlyHint: false });
  });

  // MCP has no equivalent of requiresApproval, so the model is told in prose.
  it("tells the model when a tool needs human approval", () => {
    expect(describeTool(byName("create_record")).description).toMatch(/human must approve/);
  });

  it("leaves an ungated tool's description unchanged", () => {
    expect(describeTool(byName("flag_for_review")).description).toBe(byName("flag_for_review").description);
  });
});

describe("invokeTool", () => {
  it("returns tool output as JSON text content", async () => {
    const result = await call("list_emails", { limit: 2 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.content[0]!.text)).toHaveProperty(UNTRUSTED_KEY);
  });

  // Third-party content is marked for an MCP host exactly as it is inside the
  // agent - the boundary is a property of the data, not of one consumer.
  it("wraps untrusted tool output", async () => {
    const result = await call("get_email", { email_id: "em_004" });
    const payload = JSON.parse(result.content[0]!.text);

    expect(Object.keys(payload)).toEqual([UNTRUSTED_KEY]);
    expect(payload[UNTRUSTED_KEY]).toContain("paypa1-verify.com");
  });

  it("leaves trusted tool output unwrapped", async () => {
    const result = await call("flag_for_review", { email_id: "em_004", reason: "phishing" });

    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ emailId: "em_004" });
  });

  it("reports a tool failure as an error result rather than throwing", async () => {
    const result = await call("get_email", { email_id: "em_missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/No email with id "em_missing"/);
  });

  it("rejects arguments that fail the tool's schema", async () => {
    const result = await call("get_email", { email_id: "../../etc/passwd" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Invalid arguments/);
  });

  // The guardrails belong to the tools, so every consumer inherits them.
  it("still enforces the draft output guardrails through MCP", async () => {
    const result = await call("draft_reply", {
      email_id: "em_002",
      body: "Register at https://evil.test/steal",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/do not appear in the source email/);
    expect(store.drafts).toHaveLength(0);
  });

  it("still enforces the secret guardrail through MCP", async () => {
    const result = await call("draft_reply", {
      email_id: "em_002",
      body: `Here: sk-ant-${"a".repeat(32)}`,
    });

    expect(result.isError).toBe(true);
    expect(store.drafts).toHaveLength(0);
  });
});

describe("createMcpServer", () => {
  it("builds a server without connecting a transport", () => {
    expect(createMcpServer({ tools, allowWrites: false })).toBeDefined();
  });

  it("accepts a caller-supplied tool context", () => {
    expect(createMcpServer({ tools, allowWrites: true, context: { runId: "custom" } })).toBeDefined();
  });
});

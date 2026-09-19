import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, ToolRegistry } from "../src/index";

const tool = (name: string) =>
  defineTool({
    name,
    description: `Tool ${name}`,
    schema: z.object({ value: z.string() }),
    execute: async ({ value }) => ({ value }),
  });

describe("ToolRegistry", () => {
  it("looks tools up by name and returns undefined for unknown ones", () => {
    const registry = new ToolRegistry([tool("alpha"), tool("beta")]);

    expect(registry.get("alpha")?.name).toBe("alpha");
    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate tool names", () => {
    expect(() => new ToolRegistry([tool("alpha"), tool("alpha")])).toThrow(/Duplicate tool name: alpha/);
  });

  it("strips $schema from generated definitions", () => {
    const [definition] = new ToolRegistry([tool("alpha")]).definitions();

    expect(definition).toBeDefined();
    expect(definition).not.toHaveProperty("$schema");
    expect(definition?.parameters).not.toHaveProperty("$schema");
    expect(definition?.description).toBe("Tool alpha");
  });

  it("omits fields with defaults from required, since definitions describe input", () => {
    const withDefault = defineTool({
      name: "list",
      description: "Lists things",
      schema: z.object({ limit: z.number().default(10), query: z.string() }),
      execute: async () => ({}),
    });

    const [definition] = new ToolRegistry([withDefault]).definitions();

    expect(definition?.parameters.required).toEqual(["query"]);
  });
});

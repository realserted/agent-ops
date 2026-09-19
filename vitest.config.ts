import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "llm", root: "packages/llm" } },
      { test: { name: "core", root: "packages/core" } },
      { test: { name: "tools", root: "packages/tools" } },
      { test: { name: "cli", root: "apps/cli" } },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      // Barrel files re-export only; apps/cli/src/index.ts is the composition
      // root and is exercised end-to-end rather than by unit tests.
      exclude: ["**/index.ts", "apps/cli/src/index.ts"],
      // Targets from Phase 2 of docs/HARDENING_PLAN.md. Actual coverage sits
      // well above these; the margin is deliberate headroom for the guardrail
      // code Phase 3 adds.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});

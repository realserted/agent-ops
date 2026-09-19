import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "llm", root: "packages/llm" } },
      { test: { name: "core", root: "packages/core" } },
      { test: { name: "tools", root: "packages/tools" } },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      // Barrel files re-export only; apps/cli/src/index.ts is the composition
      // root and is exercised end-to-end rather than by unit tests.
      exclude: ["**/index.ts", "apps/cli/src/index.ts"],
      // Baseline as measured after the Vitest port: packages/llm and
      // packages/tools have no tests until Phase 2 of docs/HARDENING_PLAN.md.
      // The gate only ratchets up. Phase 2 raises these to 80/80/75.
      thresholds: {
        lines: 24,
        functions: 17,
        branches: 10,
      },
    },
  },
});

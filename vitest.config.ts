import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "llm", root: "packages/llm" } },
      { test: { name: "core", root: "packages/core" } },
      { test: { name: "tools", root: "packages/tools" } },
      { test: { name: "cli", root: "apps/cli" } },
      { test: { name: "mcp", root: "apps/mcp" } },
      { test: { name: "evals", root: "packages/evals" } },
      { test: { name: "tracing", root: "packages/tracing" } },
      { test: { name: "approvals", root: "packages/approvals" } },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      // Barrel files re-export only; the apps/* entry points are composition
      // roots, exercised end-to-end rather than by unit tests. The eval runner
      // additionally cannot run offline - it exists to call a real model.
      // apps/dashboard is covered by the Playwright suite rather than unit
      // tests - its route handlers and runtime only mean anything with a
      // server running, so counting them here would misreport both numbers.
      exclude: [
        "**/index.ts",
        "apps/cli/src/index.ts",
        "apps/evals/src/index.ts",
        "apps/dashboard/**",
      ],
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

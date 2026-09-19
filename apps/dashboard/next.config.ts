import type { NextConfig } from "next";

const config: NextConfig = {
  // The workspace packages ship TypeScript source rather than built output, so
  // Next must compile them alongside the app.
  transpilePackages: [
    "@agent-ops/approvals",
    "@agent-ops/core",
    "@agent-ops/llm",
    "@agent-ops/tools",
    "@agent-ops/tracing",
  ],
};

export default config;

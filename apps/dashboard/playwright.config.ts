import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // The approval flows block on a running agent, so a shared server and serial
  // execution keep one test's queue from appearing in another's.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  // Chromium only: these assert application behaviour, not rendering
  // differences, so a second engine would double the time for no new signal.
  //
  // PLAYWRIGHT_CHANNEL drives an already-installed browser instead of the
  // bundled build - set it to "chrome" or "msedge" when Playwright's browser
  // download is blocked, which it is on some networks. CI leaves it unset and
  // uses the pinned bundled Chromium, so the canonical run stays reproducible.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: "pnpm --filter @agent-ops/dashboard start",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Never call a real API from a test.
      AGENT_OPS_TEST_PROVIDER: "scripted",
    },
  },
});

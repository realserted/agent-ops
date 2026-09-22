import { defineConfig, devices } from "@playwright/test";

/*
 * Deliberately not 3100, the port `pnpm dashboard` uses.
 *
 * With reuseExistingServer the suite will adopt whatever is already listening.
 * Sharing a port with the dev server means a running dashboard - real key, real
 * mailbox - gets used instead of the scripted one, and every test that starts a
 * run spends money on live mail. A separate port makes that collision
 * impossible rather than merely unlikely.
 */
const PORT = 3177;

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
    command: `pnpm --filter @agent-ops/dashboard exec next start --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Never call a real API from a test.
      AGENT_OPS_TEST_PROVIDER: "scripted",
    },
  },
  // A last line of defence: if the server the suite talks to is not in scripted
  // mode, fail immediately rather than billing a real provider.
  globalSetup: "./e2e/guard-scripted.ts",
  metadata: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
});

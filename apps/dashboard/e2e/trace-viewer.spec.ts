import { expect, test } from "@playwright/test";

// The queue and runs list are process-wide state, so each test starts clean.
// Without this, one test's leftover approval blocks the next test's run from
// finishing and "the first pending item" may belong to another test.
test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

const startAndOpenTrace = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByTestId("start-run").click();

  const firstRun = page.getByTestId("run-row").first();
  await expect(firstRun).toBeVisible({ timeout: 15_000 });
  // The run row opens the results view; the trace is one link further in.
  await firstRun.getByRole("link").first().click();
  await page.getByRole("link", { name: "see every step" }).click();
  await expect(page.getByTestId("event-list")).toBeVisible({ timeout: 15_000 });
};

test.describe("trace viewer", () => {
  test("shows every step, its tool calls and its token counts", async ({ page }) => {
    await startAndOpenTrace(page);

    await expect(page.getByTestId("event-llm_response").first()).toBeVisible();
    await expect(page.getByTestId("event-tool_result").first()).toBeVisible();
    await expect(page.getByTestId("event-llm_response").first()).toContainText("in /");
    await expect(page.getByTestId("event-tool_result").first()).toContainText("list emails");
  });

  test("reports the run's totals including cost", async ({ page }) => {
    await startAndOpenTrace(page);

    await page.goto("/approvals");
    await expect(page.getByTestId("pending-item").first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("approve").first().click();

    await page.goto("/");
    await page.getByTestId("run-row").first().getByRole("link").first().click();
    await page.getByRole("link", { name: "see every step" }).click();

    await expect(page.getByTestId("trace-tokens")).toContainText("in /", { timeout: 20_000 });
    await expect(page.getByTestId("trace-cost")).toBeVisible();
  });

  test("an unknown trace id shows a not-found page rather than erroring", async ({ page }) => {
    await page.goto("/traces/00000000-0000-0000-0000-000000000000");

    await expect(page.getByRole("heading", { name: "No such run" })).toBeVisible();
  });
});

test.describe("injection warning", () => {
  // The phishing fixture carries role-impersonation text, so reading it emits a
  // guardrail event. A warning nobody can see is not a control.
  test("a flagged email shows a visible warning badge", async ({ page }) => {
    await startAndOpenTrace(page);

    const badge = page.getByTestId("guardrail-badge").first();
    await expect(badge).toBeVisible({ timeout: 20_000 });
    await expect(badge).toHaveText("injection warning");
    await expect(page.getByTestId("event-guardrail").first()).toContainText("get email");
  });
});

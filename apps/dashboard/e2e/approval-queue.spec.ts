import { expect, test } from "@playwright/test";

// The queue and runs list are process-wide state, so each test starts clean.
// Without this, one test's leftover approval blocks the next test's run from
// finishing and "the first pending item" may belong to another test.
test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

/**
 * The scripted provider drives every run: list_emails, get_email on the
 * adversarial fixture, flag_for_review, then an approval-gated create_record.
 * So each run reliably parks exactly one request in the queue.
 */
const startRun = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("run-row").first()).toBeVisible();
};

test.describe("approval queue", () => {
  test("a pending action appears for a human to decide", async ({ page }) => {
    await startRun(page);
    await page.goto("/approvals");

    const pending = page.getByTestId("pending-item").first();
    await expect(pending).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("pending-tool").first()).toHaveText("create_record");
    // The human needs the arguments to decide, not just the tool name.
    await expect(page.getByTestId("pending-args").first()).toContainText("Northwind Supplies");
  });

  test("approving executes the action and clears it from the queue", async ({ page }) => {
    await startRun(page);
    await page.goto("/approvals");

    await expect(page.getByTestId("pending-item").first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("approve").first().click();

    await expect(page.getByTestId("queue-empty")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("resolved-row").first()).toContainText("approved");
  });

  test("denying blocks the action and records the denial", async ({ page }) => {
    await startRun(page);
    await page.goto("/approvals");

    await expect(page.getByTestId("pending-item").first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("deny").first().click();

    await expect(page.getByTestId("queue-empty")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("resolved-row").first()).toContainText("denied");
  });

  test("a denied run still completes rather than failing", async ({ page }) => {
    await startRun(page);
    await page.goto("/approvals");
    await expect(page.getByTestId("pending-item").first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("deny").first().click();

    await page.goto("/");
    await expect(page.getByTestId("run-row").first()).toContainText("completed", { timeout: 20_000 });
  });
});

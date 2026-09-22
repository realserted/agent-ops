import { expect, test } from "@playwright/test";

// The queue and runs list are process-wide state, so each test starts clean.
test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

/**
 * The scripted run produces one record, one draft and one flag, and reads the
 * adversarial fixture so a guardrail fires. Approving the single gated action
 * lets it finish and write everything to the store.
 */
const runToCompletion = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("run-row").first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/approvals");
  await expect(page.getByTestId("pending-item").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("approve").first().click();
  await expect(page.getByTestId("queue-empty")).toBeVisible({ timeout: 15_000 });
};

test.describe("model picker", () => {
  test("offers both providers and starts a run with the chosen one", async ({ page }) => {
    await page.goto("/");

    const options = await page.getByTestId("model-select").locator("option").allTextContents();
    expect(options.join(" ")).toContain("Claude");
    expect(options.join(" ")).toContain("Gemini");
  });

  // A rate limit that shows up as an opaque 429 mid-run is a bad first
  // experience; the picker says so up front.
  test("warns about the free-tier limit when Gemini is selected", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("model-select").selectOption("gemini-2.5-flash");

    await expect(page.getByTestId("model-note")).toContainText("20 requests/day");
  });

  test("records which model a run used", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-run").click();

    await expect(page.getByTestId("run-model").first()).not.toBeEmpty({ timeout: 15_000 });
  });
});

test.describe("results", () => {
  test("shows what the run produced, by kind", async ({ page }) => {
    await runToCompletion(page);

    await page.goto("/");
    await page.getByTestId("run-row").first().getByRole("link").first().click();

    await expect(page.getByTestId("record").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("draft").first()).toBeVisible();
    await expect(page.getByTestId("flag").first()).toBeVisible();
  });

  test("shows the extracted fields of a record", async ({ page }) => {
    await runToCompletion(page);
    await page.goto("/");
    await page.getByTestId("run-row").first().getByRole("link").first().click();

    const record = page.getByTestId("record").first();
    await expect(record).toBeVisible({ timeout: 20_000 });
    await expect(record).toContainText("Northwind Supplies");
    await expect(record).toContainText("INV-2291");
  });

  test("counts what each run produced on the runs list", async ({ page }) => {
    await runToCompletion(page);
    await page.goto("/");

    await expect(page.getByTestId("run-produced").first()).toContainText("record", { timeout: 20_000 });
  });

  // The scripted run flags an email before it reaches the gated action, so a
  // run still waiting on approval already has something to show.
  test("shows what a run has produced so far while it is still waiting", async ({ page, request }) => {
    const started = await request.post("/api/runs", { data: { task: "Triage the inbox." } });
    const { traceId } = (await started.json()) as { traceId: string };

    await page.goto(`/runs/${traceId}`);
    await expect(page.getByTestId("flag").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("record")).toHaveCount(0);
  });

  test("an unknown run id shows a not-found page rather than erroring", async ({ page }) => {
    await page.goto("/runs/00000000-0000-0000-0000-000000000000");

    await expect(page.getByRole("heading", { name: "Run not found" })).toBeVisible();
  });
});

test.describe("trust boundary", () => {
  // The whole argument of the project is that email content is data, not
  // instruction. If that is invisible on screen, an operator cannot act on it.
  test("renders the source email quarantined beside an extracted record", async ({ page }) => {
    await runToCompletion(page);
    await page.goto("/");
    await page.getByTestId("run-row").first().getByRole("link").first().click();

    const quarantined = page.getByTestId("quarantine").first();
    await expect(quarantined).toBeVisible({ timeout: 20_000 });
    await expect(quarantined).toContainText("Treated as data, never as instructions");
  });

  test("shows the email being approved, quarantined, before you decide", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-run").click();
    await page.goto("/approvals");

    await expect(page.getByTestId("pending-item").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("quarantine").first()).toBeVisible();
  });

  test("quarantines untrusted tool output in the trace", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("run-row").first()).toBeVisible({ timeout: 15_000 });

    await page.goto("/approvals");
    await expect(page.getByTestId("pending-item").first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("approve").first().click();

    await page.goto("/");
    await page.getByTestId("run-row").first().getByRole("link").first().click();
    await page.getByRole("link", { name: "see every step" }).click();

    await expect(page.getByTestId("quarantine").first()).toBeVisible({ timeout: 20_000 });
  });
});

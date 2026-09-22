import type { FullConfig } from "@playwright/test";

/**
 * Refuses to run the suite against a server that would call a real provider.
 *
 * Every spec clicks "Start run". If the server behind the base URL is a normal
 * dashboard rather than a scripted one, each of those spends money and reads a
 * real mailbox — which is exactly what happened once: a dev server was left on
 * the port the suite used, `reuseExistingServer` adopted it, and a dozen tests
 * billed a live provider.
 *
 * The test-only reset route exists only in scripted mode, so asking for it is a
 * direct question: are you the server I think you are?
 */
export default async function guardScripted(config: FullConfig): Promise<void> {
  const baseURL = (config.metadata as { baseURL?: string }).baseURL;
  if (!baseURL) throw new Error("No base URL configured; cannot verify the server is scripted.");

  const response = await fetch(new URL("/api/test/reset", baseURL), { method: "POST" }).catch(
    (error: unknown) => {
      throw new Error(
        `Could not reach the test server at ${baseURL}: ${error instanceof Error ? error.message : error}`,
      );
    },
  );

  if (response.ok) return;

  throw new Error(
    `The server at ${baseURL} is not running in scripted mode (POST /api/test/reset returned ${response.status}).\n` +
      "Refusing to run: these tests start agent runs, and against a live server that spends real API credit\n" +
      "and reads a real mailbox. Stop whatever is on that port and let Playwright start its own server.",
  );
}

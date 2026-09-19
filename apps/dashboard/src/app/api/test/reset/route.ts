import { NextResponse } from "next/server";
import { resetRuntime } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

/**
 * Clears queue and trace state between end-to-end tests.
 *
 * Gated on the same flag that stubs the model, so this route does not exist in
 * a real deployment: an unauthenticated endpoint that denies every pending
 * approval would otherwise be a denial-of-service against the approval queue.
 */
export async function POST() {
  if (process.env.AGENT_OPS_TEST_PROVIDER !== "scripted") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  resetRuntime();
  return NextResponse.json({ reset: true });
}

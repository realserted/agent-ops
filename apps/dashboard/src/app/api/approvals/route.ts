import { NextResponse } from "next/server";
import { runtime } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const { approvals } = runtime();
  return NextResponse.json({
    pending: approvals.pending(),
    resolved: approvals.resolved(20),
  });
}

export async function POST(request: Request) {
  const { approvals } = runtime();
  const body: unknown = await request.json().catch(() => null);

  const { id, decision } = (body ?? {}) as { id?: string; decision?: string };
  if (!id || (decision !== "approved" && decision !== "denied")) {
    return NextResponse.json(
      { error: 'Body must be { id: string, decision: "approved" | "denied" }.' },
      { status: 400 },
    );
  }

  // False means unknown or already decided - either way the caller's view of
  // the queue is stale, which is a conflict rather than a server error.
  if (!approvals.decide(id, decision)) {
    return NextResponse.json({ error: "No pending approval with that id." }, { status: 409 });
  }

  return NextResponse.json({ id, decision });
}

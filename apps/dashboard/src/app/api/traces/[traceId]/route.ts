import { NextResponse } from "next/server";
import { runtime } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  const found = await runtime().traces.getRun(traceId);

  if (!found) return NextResponse.json({ error: "No such trace." }, { status: 404 });
  return NextResponse.json(found);
}

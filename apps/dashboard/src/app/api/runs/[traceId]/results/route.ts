import { NextResponse } from "next/server";
import { resultsFor, runtime } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  const found = await runtime().traces.getRun(traceId);

  if (!found) return NextResponse.json({ error: "No such run." }, { status: 404 });

  return NextResponse.json({ run: found.run, ...resultsFor(traceId) });
}

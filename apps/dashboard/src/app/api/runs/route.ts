import { NextResponse } from "next/server";
import { runtime, startRun } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

const MAX_TASK = 500;

export async function GET() {
  const { traces, running } = runtime();
  const runs = await traces.listRuns(50);
  return NextResponse.json({ runs, running: [...running] });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const { task } = (body ?? {}) as { task?: unknown };

  if (typeof task !== "string" || task.trim().length === 0 || task.length > MAX_TASK) {
    return NextResponse.json(
      { error: `task must be a non-empty string of at most ${MAX_TASK} characters.` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await startRun(task.trim()), { status: 202 });
  } catch (error) {
    // A missing API key surfaces here; say so without echoing any value.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start run." },
      { status: 500 },
    );
  }
}

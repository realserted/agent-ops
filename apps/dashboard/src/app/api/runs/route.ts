import { NextResponse } from "next/server";
import { findModel } from "../../../lib/models";
import { resultsFor, runtime, startRun } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

const MAX_TASK = 500;

export async function GET() {
  const { traces, running } = runtime();
  const runs = await traces.listRuns(50);

  // Counts travel with the list so the runs page can show what each produced
  // without a request per row.
  const withResults = runs.map((run) => {
    const { records, drafts, flags } = resultsFor(run.traceId);
    return { ...run, results: { records: records.length, drafts: drafts.length, flags: flags.length } };
  });

  return NextResponse.json({ runs: withResults, running: [...running] });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const { task, model } = (body ?? {}) as { task?: unknown; model?: unknown };

  if (typeof task !== "string" || task.trim().length === 0 || task.length > MAX_TASK) {
    return NextResponse.json(
      { error: `task must be a non-empty string of at most ${MAX_TASK} characters.` },
      { status: 400 },
    );
  }

  // Validated against the same list the picker is built from, so a model the
  // operator never chose cannot reach the provider factory.
  if (model !== undefined && (typeof model !== "string" || !findModel(model))) {
    return NextResponse.json({ error: "Unknown model." }, { status: 400 });
  }

  try {
    return NextResponse.json(await startRun(task.trim(), model), { status: 202 });
  } catch (error) {
    // A missing API key surfaces here; say so without echoing any value.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start run." },
      { status: 500 },
    );
  }
}

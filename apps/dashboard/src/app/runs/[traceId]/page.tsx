"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TraceRun } from "@agent-ops/tracing";
import type { Draft, OperationsRecord, ReviewFlag } from "@agent-ops/tools";
import { QuarantinedEmail } from "../../../components/Quarantine";
import { RunError } from "../../../components/RunError";

const POLL_MS = 2_000;

interface Results {
  run: TraceRun;
  records: OperationsRecord[];
  drafts: Draft[];
  flags: ReviewFlag[];
}

export default function ResultsPage({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = use(params);
  const [data, setData] = useState<Results | undefined>();
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/runs/${traceId}/results`, { cache: "no-store" });
    if (response.status === 404) {
      setMissing(true);
      return;
    }
    if (!response.ok) return;
    setData((await response.json()) as Results);
  }, [traceId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (missing) {
    return (
      <>
        <h1>Run not found</h1>
        <p>
          <Link href="/">Back to runs</Link>
        </p>
      </>
    );
  }

  if (!data) return <p className="muted">Loading…</p>;

  const { run, records, drafts, flags } = data;
  const nothing = records.length === 0 && drafts.length === 0 && flags.length === 0;

  return (
    <>
      <h1>{run.task}</h1>
      <p className="meta" data-testid="run-summary">
        {run.model} · {run.status ?? "running"} · {run.steps ?? 0} steps ·{" "}
        {run.usage ? `${run.usage.inputTokens} in / ${run.usage.outputTokens} out` : "—"} ·{" "}
        {run.cost === undefined ? "unpriced" : `$${run.cost.toFixed(4)}`} ·{" "}
        <Link href={`/traces/${run.traceId}`}>see every step</Link>
      </p>

      {run.error && <RunError error={run.error} />}

      {nothing && !run.error && (
        <p className="muted" data-testid="no-results">
          {run.status === "completed"
            ? "This run finished without recording anything. Nothing in the mailbox needed action."
            : "Nothing recorded yet."}
        </p>
      )}

      {records.length > 0 && (
        <>
          <h2>Records</h2>
          <div data-testid="records">
            {records.map((record) => (
              <div className="entry" key={record.id} data-testid="record">
                <div className="entry-head">
                  <span className="kind">{record.kind.replace("_", " ")}</span>
                  <span className="meta">from email {record.emailId}</span>
                </div>
                <dl className="fields">
                  {Object.entries(record.data).map(([name, value]) => (
                    <div key={name} style={{ display: "contents" }}>
                      <dt>{name.replace(/_/g, " ")}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <QuarantinedEmail emailId={record.emailId} />
              </div>
            ))}
          </div>
        </>
      )}

      {drafts.length > 0 && (
        <>
          <h2>Drafts</h2>
          <p className="muted">Saved, not sent. Nothing leaves without you sending it.</p>
          <div data-testid="drafts">
            {drafts.map((draft) => (
              <div className="entry" key={draft.id} data-testid="draft">
                <div className="entry-head">
                  <span className="kind">reply</span>
                  <span className="meta">to email {draft.emailId}</span>
                </div>
                {/* The draft is the system's own words, so it is not quarantined. */}
                <p style={{ whiteSpace: "pre-wrap" }}>{draft.body}</p>
                <QuarantinedEmail emailId={draft.emailId} />
              </div>
            ))}
          </div>
        </>
      )}

      {flags.length > 0 && (
        <>
          <h2>Flagged for review</h2>
          <div data-testid="flags">
            {flags.map((flag) => (
              <div className="entry" key={flag.id} data-testid="flag">
                <div className="entry-head">
                  <span className="kind">flagged</span>
                  <span className="meta">email {flag.emailId}</span>
                </div>
                <p>{flag.reason}</p>
                <QuarantinedEmail emailId={flag.emailId} />
              </div>
            ))}
          </div>
        </>
      )}

      <p style={{ marginTop: "2rem" }}>
        <Link href="/">Back to runs</Link>
      </p>
    </>
  );
}

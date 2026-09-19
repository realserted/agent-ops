"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TraceEvent, TraceRun } from "@agent-ops/tracing";

const POLL_MS = 1_500;
const MAX_PREVIEW = 400;

const preview = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text && text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}...` : (text ?? "");
};

export default function TracePage({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = use(params);
  const [run, setRun] = useState<TraceRun | undefined>();
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/traces/${traceId}`, { cache: "no-store" });
    if (response.status === 404) {
      setMissing(true);
      return;
    }
    if (!response.ok) return;
    const data = (await response.json()) as { run: TraceRun; events: TraceEvent[] };
    setRun(data.run);
    setEvents(data.events);
  }, [traceId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (missing) {
    return (
      <>
        <h1>Trace not found</h1>
        <p className="muted">
          <Link href="/">Back to runs</Link>
        </p>
      </>
    );
  }

  if (!run) return <p className="muted">Loading...</p>;

  return (
    <>
      <h1>Trace</h1>
      <div className="panel">
        <div className="row" style={{ gap: "1.5rem" }}>
          <span>
            <span className="muted">Model</span> {run.model}
          </span>
          <span>
            <span className="muted">Status</span> {run.error ? "error" : (run.status ?? "running")}
          </span>
          <span>
            <span className="muted">Steps</span> {run.steps ?? "-"}
          </span>
          <span data-testid="trace-tokens">
            <span className="muted">Tokens</span>{" "}
            {run.usage ? `${run.usage.inputTokens} in / ${run.usage.outputTokens} out` : "-"}
          </span>
          <span data-testid="trace-cost">
            <span className="muted">Cost</span>{" "}
            {run.cost === undefined ? "unpriced" : `$${run.cost.toFixed(5)}`}
          </span>
        </div>
        <p className="muted" style={{ margin: "0.6rem 0 0" }}>
          {run.task}
        </p>
        {run.error && (
          <p className="badge badge-error" style={{ marginTop: "0.6rem" }}>
            {run.error}
          </p>
        )}
      </div>

      <h2>Steps</h2>
      {events.length === 0 ? (
        <p className="muted">No events recorded yet.</p>
      ) : (
        <div data-testid="event-list">
          {events.map((entry) => (
            <div className="panel step" key={entry.sequence} data-testid={`event-${entry.event.type}`}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  step {entry.event.step} · {entry.event.type.replace("_", " ")}
                </strong>
                <span className="muted">{new Date(entry.recordedAt).toLocaleTimeString()}</span>
              </div>

              {entry.event.type === "llm_response" && (
                <>
                  <p className="muted" style={{ margin: "0.35rem 0" }}>
                    {entry.event.usage.inputTokens} in / {entry.event.usage.outputTokens} out ·{" "}
                    {Math.round(entry.event.durationMs)}ms
                  </p>
                  {entry.event.toolCalls.map((call) => (
                    <pre key={call.id}>
                      {call.name}({preview(call.args)})
                    </pre>
                  ))}
                  {entry.event.content && <pre>{preview(entry.event.content)}</pre>}
                </>
              )}

              {entry.event.type === "tool_result" && (
                <>
                  <div className="row" style={{ margin: "0.35rem 0" }}>
                    <span className={`badge${entry.event.result.isError ? " badge-error" : ""}`}>
                      {entry.event.result.isError ? "error" : "ok"}
                    </span>
                    <span>{entry.event.result.name}</span>
                  </div>
                  <pre>{preview(entry.event.result.output)}</pre>
                </>
              )}

              {/* The whole point of the guardrail event is that a human sees it. */}
              {entry.event.type === "guardrail" && (
                <div className="row" style={{ marginTop: "0.35rem" }}>
                  <span className="badge badge-warn" data-testid="guardrail-badge">
                    injection warning
                  </span>
                  <span>{entry.event.tool}</span>
                  <span className="muted">{entry.event.warnings.join(", ")}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/">Back to runs</Link>
      </p>
    </>
  );
}

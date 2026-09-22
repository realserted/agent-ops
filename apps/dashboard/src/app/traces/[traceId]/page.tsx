"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TraceEvent, TraceRun } from "@agent-ops/tracing";
import { Quarantine } from "../../../components/Quarantine";
import { RunError } from "../../../components/RunError";

const POLL_MS = 1_500;
const MAX_PREVIEW = 400;

/** The agent wraps third-party tool output under this key before the model sees it. */
const UNTRUSTED_KEY = "untrusted_content";

/** Returns the third-party text when output crossed the boundary, else undefined. */
const untrustedText = (output: unknown): string | undefined => {
  if (!output || typeof output !== "object") return undefined;
  const value = (output as Record<string, unknown>)[UNTRUSTED_KEY];
  return typeof value === "string" ? value : undefined;
};

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
        <h1>No such run</h1>
        <p className="muted">
          <Link href="/">Back to runs</Link>
        </p>
      </>
    );
  }

  if (!run) return <p className="muted">Loading...</p>;

  return (
    <>
      <h1>{run.task}</h1>
      <p className="meta" data-testid="trace-summary">
        {run.model} · {run.error ? "error" : (run.status ?? "running")} · {run.steps ?? 0} steps ·{" "}
        <span data-testid="trace-tokens">
          {run.usage ? `${run.usage.inputTokens} in / ${run.usage.outputTokens} out` : "—"}
        </span>{" "}
        · <span data-testid="trace-cost">{run.cost === undefined ? "unpriced" : `$${run.cost.toFixed(5)}`}</span> ·{" "}
        <Link href={`/runs/${run.traceId}`}>see what it produced</Link>
      </p>
      {run.error && <RunError error={run.error} />}

      <h2>Steps</h2>
      {events.length === 0 ? (
        <p className="muted">No events recorded yet.</p>
      ) : (
        <div data-testid="event-list">
          {events.map((entry) => (
            <div className="step" key={entry.sequence} data-testid={`event-${entry.event.type}`}>
              <div className="entry-head" style={{ justifyContent: "space-between" }}>
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
                  <div className="bar" style={{ margin: "0.35rem 0" }}>
                    <span className={entry.event.result.isError ? "tag-refuse" : "tag"}>
                      {entry.event.result.isError ? "error" : "ok"}
                    </span>
                    <span>{entry.event.result.name.replace(/_/g, " ")}</span>
                  </div>
                  {/*
                    Output the agent wrapped as untrusted came from outside the
                    system, so it is shown the same way here as anywhere else.
                  */}
                  {untrustedText(entry.event.result.output) ? (
                    <Quarantine body={untrustedText(entry.event.result.output)} />
                  ) : (
                    <pre>{preview(entry.event.result.output)}</pre>
                  )}
                </>
              )}

              {/* The whole point of the guardrail event is that a human sees it. */}
              {entry.event.type === "guardrail" && (
                <div className="bar" style={{ marginTop: "0.35rem" }}>
                  <span className="tag-warn" data-testid="guardrail-badge">
                    injection warning
                  </span>
                  <span>{entry.event.tool.replace(/_/g, " ")}</span>
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

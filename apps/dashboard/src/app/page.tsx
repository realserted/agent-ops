"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TraceRun } from "@agent-ops/tracing";

const POLL_MS = 1_500;

export default function RunsPage() {
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [task, setTask] = useState("Triage the inbox.");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const response = await fetch("/api/runs", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { runs: TraceRun[]; running: string[] };
    setRuns(data.runs);
    setRunning(data.running);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) setError(data.error ?? "Failed to start run.");
      await load();
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <h1>Runs</h1>

      <div className="panel">
        <div className="row">
          <input
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            aria-label="Task"
            data-testid="task-input"
          />
          <button className="primary" onClick={() => void start()} disabled={starting} data-testid="start-run">
            {starting ? "Starting..." : "Start run"}
          </button>
        </div>
        {error && (
          <p className="badge badge-error" data-testid="run-error" style={{ marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
        <p className="muted" style={{ margin: "0.75rem 0 0" }}>
          A run pauses at every approval-gated action. Answer it on the{" "}
          <Link href="/approvals">approvals</Link> page.
        </p>
      </div>

      {runs.length === 0 ? (
        <p className="muted" data-testid="no-runs">
          No runs yet.
        </p>
      ) : (
        <table data-testid="runs-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Model</th>
              <th>Task</th>
              <th>Status</th>
              <th>Steps</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.traceId} data-testid="run-row">
                <td>
                  <Link href={`/traces/${run.traceId}`}>{new Date(run.startedAt).toLocaleTimeString()}</Link>
                </td>
                <td className="muted">{run.model}</td>
                <td>{run.task}</td>
                <td>
                  {running.includes(run.traceId) ? (
                    <span className="badge" data-testid="status-running">
                      running
                    </span>
                  ) : (
                    <span className={`badge${run.error ? " badge-error" : ""}`}>
                      {run.error ? "error" : (run.status ?? "unknown")}
                    </span>
                  )}
                </td>
                <td>{run.steps ?? "-"}</td>
                <td className="muted">
                  {run.usage ? `${run.usage.inputTokens} / ${run.usage.outputTokens}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

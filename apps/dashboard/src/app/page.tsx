"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TraceRun } from "@agent-ops/tracing";
import { DEFAULT_MODEL_ID, findModel, MODELS } from "../lib/models";

const POLL_MS = 1_500;

interface RunRow extends TraceRun {
  results: { records: number; drafts: number; flags: number };
}

const produced = (r: RunRow["results"]) =>
  [
    r.records ? `${r.records} record${r.records === 1 ? "" : "s"}` : "",
    r.drafts ? `${r.drafts} draft${r.drafts === 1 ? "" : "s"}` : "",
    r.flags ? `${r.flags} flag${r.flags === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(", ");

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [task, setTask] = useState("Triage the inbox.");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const response = await fetch("/api/runs", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { runs: RunRow[]; running: string[] };
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
        body: JSON.stringify({ task, model: modelId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) setError(data.error ?? "Could not start the run.");
      await load();
    } finally {
      setStarting(false);
    }
  };

  const note = findModel(modelId)?.note;

  return (
    <>
      <h1>Runs</h1>

      <div className="bar">
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          aria-label="Task"
          data-testid="task-input"
        />
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          aria-label="Model"
          data-testid="model-select"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button className="assert" onClick={() => void start()} disabled={starting} data-testid="start-run">
          {starting ? "Starting…" : "Start run"}
        </button>
      </div>

      {note && (
        <p className="muted" data-testid="model-note">
          {note}
        </p>
      )}
      {error && (
        <p className="tag-refuse" data-testid="run-error">
          {error}
        </p>
      )}
      <p className="muted">
        A run stops at every action that needs a human. Answer those on the{" "}
        <Link href="/approvals">approvals</Link> page.
      </p>

      <h2>History</h2>
      {runs.length === 0 ? (
        <p className="muted" data-testid="no-runs">
          Nothing has run yet. Start one above.
        </p>
      ) : (
        <table data-testid="runs-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Model</th>
              <th>Status</th>
              <th>Steps</th>
              <th>Cost</th>
              <th>Produced</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.traceId} data-testid="run-row">
                <td>
                  <Link href={`/runs/${run.traceId}`}>{new Date(run.startedAt).toLocaleTimeString()}</Link>
                </td>
                <td data-testid="run-model">{run.model}</td>
                <td>
                  {running.includes(run.traceId) ? (
                    <span data-testid="status-running">running</span>
                  ) : (
                    <span className={run.error ? "tag-refuse" : undefined}>
                      {run.error ? "error" : (run.status ?? "unknown")}
                    </span>
                  )}
                </td>
                <td>{run.steps ?? "—"}</td>
                <td className="muted">{run.cost === undefined ? "—" : `$${run.cost.toFixed(4)}`}</td>
                <td data-testid="run-produced">{produced(run.results) || <span className="muted">nothing</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

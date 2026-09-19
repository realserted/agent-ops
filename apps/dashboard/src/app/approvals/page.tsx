"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PendingApproval, ResolvedApproval } from "@agent-ops/approvals";

const POLL_MS = 1_000;

export default function ApprovalsPage() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [resolved, setResolved] = useState<ResolvedApproval[]>([]);
  const [busy, setBusy] = useState<string | undefined>();

  const load = useCallback(async () => {
    const response = await fetch("/api/approvals", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { pending: PendingApproval[]; resolved: ResolvedApproval[] };
    setPending(data.pending);
    setResolved(data.resolved);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const decide = async (id: string, decision: "approved" | "denied") => {
    setBusy(id);
    try {
      await fetch("/api/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      await load();
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <h1>Approval queue</h1>

      {pending.length === 0 ? (
        <p className="muted" data-testid="queue-empty">
          Nothing waiting. A run pauses here when it reaches an action that needs a human.
        </p>
      ) : (
        <div data-testid="pending-list">
          {pending.map((item) => (
            <div className="panel" key={item.id} data-testid="pending-item">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong data-testid="pending-tool">{item.toolName}</strong>
                <span className="muted">{new Date(item.requestedAt).toLocaleTimeString()}</span>
              </div>

              <pre data-testid="pending-args">{JSON.stringify(item.args, null, 2)}</pre>

              <div className="row" style={{ marginTop: "0.8rem" }}>
                <button
                  className="primary"
                  onClick={() => void decide(item.id, "approved")}
                  disabled={busy === item.id}
                  data-testid="approve"
                >
                  Approve
                </button>
                <button
                  className="danger"
                  onClick={() => void decide(item.id, "denied")}
                  disabled={busy === item.id}
                  data-testid="deny"
                >
                  Deny
                </button>
                {item.traceId && (
                  <Link href={`/traces/${item.traceId}`} className="muted">
                    view trace
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2>Recently decided</h2>
      {resolved.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <table data-testid="resolved-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Decision</th>
              <th>Decided</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((item) => (
              <tr key={item.id} data-testid="resolved-row">
                <td>{item.toolName}</td>
                <td>
                  <span className={`badge${item.decision === "approved" ? "" : " badge-error"}`}>
                    {item.decision}
                  </span>
                </td>
                <td className="muted">{new Date(item.decidedAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PendingApproval, ResolvedApproval } from "@agent-ops/approvals";
import { QuarantinedEmail } from "../../components/Quarantine";

const POLL_MS = 1_000;

/** The email an action refers to, when its arguments name one. */
const emailIdOf = (args: Record<string, unknown>): string | undefined =>
  typeof args.email_id === "string" ? args.email_id : undefined;

function Arguments({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args).filter(([key]) => key !== "email_id");

  return (
    <dl className="fields" data-testid="pending-args">
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: "contents" }}>
          <dt>{key.replace(/_/g, " ")}</dt>
          <dd>
            {Array.isArray(value)
              ? value
                  .map((v) =>
                    v && typeof v === "object" && "name" in v && "value" in v
                      ? `${String((v as { name: unknown }).name)}: ${String((v as { value: unknown }).value)}`
                      : JSON.stringify(v),
                  )
                  .join(" · ")
              : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

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
      <h1>Waiting on you</h1>

      {pending.length === 0 ? (
        <p className="muted" data-testid="queue-empty">
          Nothing to decide. A run stops here when it reaches an action that needs a human.
        </p>
      ) : (
        <div data-testid="pending-list">
          {pending.map((item) => {
            const emailId = emailIdOf(item.args);
            return (
              <div className="entry" key={item.id} data-testid="pending-item">
                <div className="entry-head">
                  <span className="kind" data-testid="pending-tool">
                    {item.toolName.replace(/_/g, " ")}
                  </span>
                  <span className="meta">{new Date(item.requestedAt).toLocaleTimeString()}</span>
                  {item.traceId && (
                    <Link href={`/runs/${item.traceId}`} className="meta">
                      see the run
                    </Link>
                  )}
                </div>

                <Arguments args={item.args} />

                {/* Read the source before vouching for what was pulled out of it. */}
                {emailId && <QuarantinedEmail emailId={emailId} />}

                <div className="bar" style={{ marginTop: "0.8rem" }}>
                  <button
                    className="assert"
                    onClick={() => void decide(item.id, "approved")}
                    disabled={busy === item.id}
                    data-testid="approve"
                  >
                    Approve
                  </button>
                  <button
                    className="refuse"
                    onClick={() => void decide(item.id, "denied")}
                    disabled={busy === item.id}
                    data-testid="deny"
                  >
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2>Already decided</h2>
      {resolved.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <table data-testid="resolved-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Decision</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((item) => (
              <tr key={item.id} data-testid="resolved-row">
                <td>{item.toolName.replace(/_/g, " ")}</td>
                <td className={item.decision === "approved" ? undefined : "tag-refuse"}>{item.decision}</td>
                <td className="muted">{new Date(item.decidedAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

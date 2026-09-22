"use client";

import { useEffect, useState } from "react";

export interface QuarantineEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

const MAX_BODY = 1200;

/**
 * Renders text that came from outside the system.
 *
 * Every piece of third-party content on every page goes through here, so the
 * boundary cannot be styled in one place and forgotten in another. The cool
 * ground, the rule and the serif face all say the same thing: a stranger wrote
 * this, and it is being shown to you as evidence, not as instruction.
 */
export function Quarantine({
  from,
  subject,
  body,
  children,
}: {
  from?: string;
  subject?: string;
  body?: string;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = body ?? "";
  const long = text.length > MAX_BODY;
  const shown = expanded || !long ? text : `${text.slice(0, MAX_BODY)}…`;

  return (
    <div className="quarantine" data-testid="quarantine">
      {(from || subject) && (
        <div className="quarantine-head">
          {from && <div>{from}</div>}
          {subject && <div>{subject}</div>}
        </div>
      )}

      {children ?? <p className="quarantine-body">{shown}</p>}

      <div className="quarantine-foot">
        Written by the sender. Treated as data, never as instructions.
        {long && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{ padding: "0 0.3rem", background: "none", border: 0, textDecoration: "underline" }}
            >
              {expanded ? "Show less" : `Show all ${text.length} characters`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Fetches and quarantines one email by id.
 *
 * Used wherever the UI names an email the operator cannot otherwise see -
 * beside an extracted record, or beside an approval they are being asked to
 * grant.
 */
export function QuarantinedEmail({ emailId }: { emailId: string }) {
  const [email, setEmail] = useState<QuarantineEmail | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/emails/${encodeURIComponent(emailId)}`, { cache: "no-store" });
      const data = (await response.json()) as { email?: QuarantineEmail; error?: string };
      if (cancelled) return;
      if (response.ok && data.email) setEmail(data.email);
      else setError(data.error ?? "Could not load the email.");
    })();
    return () => {
      cancelled = true;
    };
  }, [emailId]);

  if (error) {
    return (
      <p className="muted" data-testid="email-error">
        {emailId}: {error}
      </p>
    );
  }
  if (!email) return <p className="muted">Loading {emailId}…</p>;

  return <Quarantine from={email.from} subject={email.subject} body={email.body} />;
}

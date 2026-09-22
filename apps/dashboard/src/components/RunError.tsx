"use client";

import { useState } from "react";
import { describeRunError } from "../lib/errors";

/**
 * Shows a failed run as a sentence, with the provider's own response tucked
 * behind a toggle for when the sentence is not enough.
 */
export function RunError({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  const { headline, detail, raw } = describeRunError(error);

  return (
    <div data-testid="run-error-detail">
      <p className="tag-refuse" style={{ margin: "0.4rem 0 0" }}>
        {headline}
      </p>
      {detail && <p className="muted">{detail}</p>}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ padding: 0, background: "none", border: 0, textDecoration: "underline", fontSize: "0.82rem" }}
      >
        {open ? "Hide the provider's response" : "Show the provider's response"}
      </button>
      {open && <pre>{raw}</pre>}
    </div>
  );
}

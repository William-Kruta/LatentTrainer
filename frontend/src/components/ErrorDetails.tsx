import { useState } from "react";

export function ErrorDetails({ title = "Error", message, details }: {
  title?: string;
  message: string;
  details?: unknown;
}) {
  const [open, setOpen] = useState(false);
  const diagnostic = typeof details === "string" ? details : JSON.stringify(details ?? { message }, null, 2);
  return (
    <div className="error-details-card">
      <div className="error-details-header">
        <div>
          <strong>{title}</strong>
          <p>{message}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setOpen(v => !v)}>
          {open ? "Hide" : "Details"}
        </button>
      </div>
      {open ? (
        <>
          <pre>{diagnostic}</pre>
          <button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(diagnostic)}>
            Copy diagnostics
          </button>
        </>
      ) : null}
    </div>
  );
}

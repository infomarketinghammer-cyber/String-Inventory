"use client";

/** Last-resort error page (also covers the login page): a plain message, never technical details. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f5f7f5", color: "#17241c", margin: 0 }}>
        <div style={{ maxWidth: 520, margin: "15vh auto", padding: 24, background: "#fff", border: "1px solid #d9e2dc", borderRadius: 12 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#5b6b61" }}>
            The page could not be loaded. Nothing was saved. Please try again; if it keeps happening, contact the administrator.
          </p>
          {error.digest && <p style={{ fontSize: 12, color: "#5b6b61" }}>Reference: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ marginTop: 8, padding: "8px 16px", background: "#1f8a4c", color: "#fff", border: 0, borderRadius: 8, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

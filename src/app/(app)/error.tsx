"use client";

import Link from "next/link";

/**
 * Safety net for any screen inside the app: if something unexpected fails, the user sees a plain message and a way
 * back, never technical details. The details are in the server log; `digest` is a reference for the administrator.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const noPermission = error.name === "PolicyError" || /forbidden|permission/i.test(error.message ?? "");
  return (
    <div className="card p-6 max-w-xl space-y-3">
      <h1 className="text-xl font-semibold">{noPermission ? "Not permitted" : "Something went wrong"}</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {noPermission
          ? "You do not have permission to do this. Ask an Admin if you need access."
          : "This page could not be loaded or the action could not be completed. Nothing was saved. Please try again; if it keeps happening, contact the administrator."}
      </p>
      {error.digest && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Reference: {error.digest}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={reset}>
          Try again
        </button>
        <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}

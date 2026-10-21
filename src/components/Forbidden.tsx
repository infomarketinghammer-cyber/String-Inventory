/** Shown when a signed-in user lacks the permission for a page (Section 9 matrix). */
export function Forbidden({ what }: { what: string }) {
  return (
    <div className="card p-6">
      <h1 className="text-lg font-semibold mb-1">403 – Not permitted</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Your role does not have access to {what}. Ask an Admin if you need it.
      </p>
    </div>
  );
}

/** Shown in the content area while a screen's data loads (the sidebar and top bar stay in place). */
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span className="text-sm" style={{ color: "var(--muted)" }}>
        Loading…
      </span>
    </div>
  );
}

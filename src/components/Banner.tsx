export function Banner({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <div className="mb-4">
      {ok && (
        <p className="rounded bg-green-50 border border-green-200 text-green-800 px-3 py-2 text-sm">{ok}</p>
      )}
      {err && <p className="rounded bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">{err}</p>}
    </div>
  );
}

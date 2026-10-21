import type { ReportTable } from "@/server/services/reports";

/** Download links for the current report + filters. */
export function ExportLinks({ report, params }: { report: string; params: Record<string, string | undefined> }) {
  const qs = (format: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("format", format);
    return `/api/reports/${report}?${sp.toString()}`;
  };
  return (
    <div className="no-print flex gap-3 text-sm">
      <a href={qs("xlsx")} className="underline">
        Export Excel
      </a>
      <a href={qs("pdf")} className="underline">
        Export PDF
      </a>
    </div>
  );
}

/** Generic read-only table for a ReportTable (same data as the exports). */
export function ReportTableView({ table, highlight }: { table: ReportTable; highlight?: (row: (string | number)[]) => boolean }) {
  return (
    <div className="card p-4 overflow-x-auto">
      <h2 className="font-medium">{table.title}</h2>
      {table.subtitle && (
        <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          {table.subtitle}
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            {table.columns.map((c) => (
              <th key={c} className="py-2 pr-3 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr
              key={i}
              className="border-b"
              style={{ borderColor: "var(--border)", background: highlight?.(r) ? "rgba(239,68,68,0.08)" : undefined }}
            >
              {r.map((cell, j) => (
                <td key={j} className="py-2 pr-3 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {table.rows.length === 0 && (
            <tr>
              <td colSpan={table.columns.length} className="py-3" style={{ color: "var(--muted)" }}>
                No data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

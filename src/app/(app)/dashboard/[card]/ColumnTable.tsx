"use client";

/**
 * Reusable "default columns + optional columns" table for the dashboard detail pages.
 * Default columns are always shown; the user adds/removes optional ones with the "+ Add columns" picker.
 * Purely presentational: rows arrive fully computed from the server.
 */
import { Fragment, useEffect, useRef, useState } from "react";

export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  /** Default columns are always shown and cannot be removed. */
  fixed?: boolean;
  /** Allow the cell text to wrap (e.g. two-line cells). */
  wrap?: boolean;
  cell: (row: T) => React.ReactNode;
  /** Total-row value (already formatted) for numeric columns. */
  total?: (rows: T[]) => string;
}

/** Which optional columns are selected; remembered per viewer in the browser (convenience only). */
export function useColumnSelection<T>(storageKey: string, columns: Column<T>[]) {
  const optional = columns.filter((c) => !c.fixed);
  // A Set keeps every optional column at most once.
  const [extra, setExtra] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[];
      setExtra(new Set(optional.map((c) => c.key).filter((k) => saved.includes(k))));
    } catch {
      /* storage unavailable: start with the defaults */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = (next: Set<string>) => {
    setExtra(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  const toggle = (key: string) => {
    const next = new Set(extra);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };

  return {
    extra,
    toggle,
    selectAll: () => update(new Set(optional.map((c) => c.key))),
    clear: () => update(new Set()),
    visible: columns.filter((c) => c.fixed || extra.has(c.key)),
  };
}

type Selection<T> = ReturnType<typeof useColumnSelection<T>>;

export function ColumnPicker<T>({ columns, selection }: { columns: Column<T>[]; selection: Selection<T> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fixed = columns.filter((c) => c.fixed);
  const optional = columns.filter((c) => !c.fixed);
  const selected = optional.filter((c) => selection.extra.has(c.key));

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="relative" ref={ref}>
        <button
          type="button"
          className="btn-secondary text-sm px-3 py-1.5"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((o) => !o)}
        >
          + Add columns{selected.length > 0 ? ` (${selected.length})` : ""}
        </button>
        {open && (
          <div
            className="card absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] p-3 text-sm"
            role="dialog"
            aria-label="Choose table columns"
          >
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
              Always shown
            </div>
            <ul className="mb-3 space-y-1">
              {fixed.map((c) => (
                <li key={c.key} className="flex items-center gap-2" style={{ color: "var(--muted)" }}>
                  <input type="checkbox" checked disabled aria-label={`${c.label} (always shown)`} />
                  <span>{c.label}</span>
                  <span className="ml-auto text-[0.65rem] uppercase tracking-wide">Default</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Additional columns
              </span>
              <span className="flex gap-2 text-xs">
                <button type="button" className="underline" style={{ color: "var(--brand)" }} onClick={selection.selectAll}>
                  All
                </button>
                <button type="button" className="underline" style={{ color: "var(--brand)" }} onClick={selection.clear}>
                  None
                </button>
              </span>
            </div>
            <ul className="space-y-1">
              {optional.map((c) => (
                <li key={c.key}>
                  <label className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--brand-soft)]">
                    <input type="checkbox" checked={selection.extra.has(c.key)} onChange={() => selection.toggle(c.key)} />
                    <span>{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {selected.length === 0 ? (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          Showing the {fixed.length} default columns. Use “+ Add columns” to show more details.
        </span>
      ) : (
        selected.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            style={{ borderColor: "var(--brand)", color: "var(--brand-ink)", background: "var(--brand-soft)" }}
          >
            {c.label}
            <button
              type="button"
              aria-label={`Remove ${c.label} column`}
              className="leading-none px-0.5"
              onClick={() => selection.toggle(c.key)}
            >
              ×
            </button>
          </span>
        ))
      )}
    </div>
  );
}

/** Table body for the visible columns, with an optional detail row (e.g. ledger movements) under each record. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  detailRow,
  emptyText,
  showTotal,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  detailRow?: (row: T, colSpan: number) => React.ReactNode;
  emptyText: string;
  showTotal?: boolean;
}) {
  const hasTotals = showTotal && rows.length > 0 && columns.some((c) => c.total);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            {columns.map((c) => (
              <th key={c.key} className={`py-1 pr-4 whitespace-nowrap ${c.numeric ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={rowKey(r)}>
              <tr>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`py-1.5 pr-4 align-top ${c.numeric ? "text-right tabular-nums" : ""} ${
                      c.wrap ? "" : "whitespace-nowrap"
                    }`}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
              {detailRow?.(r, columns.length)}
            </Fragment>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-3" style={{ color: "var(--muted)" }}>
                {emptyText}
              </td>
            </tr>
          )}
          {hasTotals && (
            <tr className="font-semibold">
              {columns.map((c, i) => (
                <td key={c.key} className={`py-1 pr-4 whitespace-nowrap ${c.numeric ? "text-right tabular-nums" : ""}`}>
                  {i === 0 ? "Total" : c.total ? c.total(rows) : ""}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

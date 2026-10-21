/** Status badge colors per the UI spec: Quality Hold=amber, Available=green, Rejected=red, At Job Worker=blue. */
const MAP: Record<string, { cls: string; label: string }> = {
  QUALITY_HOLD: { cls: "badge-hold", label: "Quality Hold" },
  AVAILABLE: { cls: "badge-available", label: "Available" },
  REJECTED: { cls: "badge-rejected", label: "Rejected" },
  CONSUMED: { cls: "badge-rejected bg-gray-200 text-gray-700", label: "Consumed" },
  AT_JOB_WORK: { cls: "badge-atjw", label: "At Job Worker" },
  IN_HOUSE: { cls: "badge-available", label: "In-house" },
  JW_RETURN_QC: { cls: "badge-hold", label: "JW Return QC" },
  CLOSED: { cls: "badge-atjw", label: "Closed" },
  OPEN: { cls: "badge-hold", label: "Open" },
  PARTIALLY_ISSUED: { cls: "badge-atjw", label: "Partially Issued" },
  PENDING: { cls: "badge-hold", label: "Pending" },
  OVERDUE: { cls: "badge-rejected", label: "Overdue" },
  PARTIALLY_RECEIVED: { cls: "badge-atjw", label: "Partially Received" },
  RTS: { cls: "badge-atjw", label: "Returned to supplier" },
  REWORK: { cls: "badge-available", label: "Rework" },
  SCRAP: { cls: "badge-rejected", label: "Scrapped" },
  DEVIATION: { cls: "badge-available", label: "Accepted (deviation)" },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = MAP[status] ?? { cls: "badge-hold", label: status };
  return <span className={`badge ${entry.cls}`}>{entry.label}</span>;
}

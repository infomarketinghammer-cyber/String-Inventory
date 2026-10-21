/** Date format DD-MMM-YYYY, kg 2 decimals, nos integers (UI spec). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mmm = MONTHS[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  return `${dd}-${mmm}-${yyyy}`;
}

/** Accepts number, string or Prisma Decimal (anything with a numeric toString). */
type Numeric = number | string | { toString(): string };

export function formatKg(n: Numeric): string {
  return Number(n.toString()).toFixed(2);
}

export function formatNos(n: Numeric): string {
  return Math.round(Number(n.toString())).toLocaleString("en-IN");
}

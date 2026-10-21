"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/server/policy";

interface NavItem {
  href: string;
  label: string;
  adminOnly?: boolean;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { title: "Overview", items: [{ href: "/dashboard", label: "Dashboard" }] },
  {
    title: "Receipt & QC",
    items: [
      { href: "/grn", label: "GRN (Receipt)" },
      { href: "/iqc", label: "IQC" },
    ],
  },
  {
    title: "Stores & Production",
    items: [
      { href: "/mrn", label: "MRN" },
      { href: "/issue", label: "Material Issue (FIFO)" },
      { href: "/return-to-stores", label: "Return to Stores" },
      { href: "/production", label: "Production / Operations" },
    ],
  },
  {
    title: "Job Work",
    items: [
      { href: "/jobwork/out", label: "JW Out Challan" },
      { href: "/jobwork/in", label: "JW In Receipt" },
    ],
  },
  {
    title: "FG & Dispatch",
    items: [
      { href: "/final-inspection", label: "Final Inspection" },
      { href: "/dispatch", label: "Dispatch" },
    ],
  },
  {
    title: "Rejections",
    items: [{ href: "/rejections", label: "Rejections / Disposal", adminOnly: true }],
  },
  {
    title: "Admin",
    items: [
      { href: "/adjustments", label: "Stock Adjustment", adminOnly: true },
      { href: "/reversals", label: "Transaction Reversal", adminOnly: true },
      { href: "/users", label: "User Management", adminOnly: true },
    ],
  },
  {
    title: "Masters",
    items: [{ href: "/masters", label: "Masters" }],
  },
  {
    title: "Reports",
    items: [
      { href: "/reports/aging", label: "Inventory Aging", adminOnly: true },
      { href: "/reports/jobwork", label: "Job Work Report" },
      { href: "/reports/stock-summary", label: "Stock Summary" },
      { href: "/reports/rejections", label: "Rejection Report", adminOnly: true },
      { href: "/reports/mrn-status", label: "MRN Status" },
      { href: "/reports/schedule-vs-dispatch", label: "Schedule vs Dispatch", adminOnly: true },
      { href: "/traceability", label: "Traceability Explorer", adminOnly: true },
    ],
  },
];

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/**
 * Fixed left navigation: it never scrolls with the page (the main area has its own scroll),
 * and it scrolls on its own when the menu is taller than the window.
 */
export function Sidebar({ role }: { role: Role }) {
  const path = usePathname() ?? "";
  return (
    <aside className="no-print hidden md:flex w-64 shrink-0 h-screen flex-col">
      {/* White brand band: the logo artwork is designed for a white background. Same height as the top bar. */}
      <Link
        href="/dashboard"
        className="flex h-16 shrink-0 items-center gap-2.5 px-5 border-b border-r bg-white"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-[1.05rem] font-semibold tracking-tight leading-tight text-[#0e5a33]">Spring Inventory</span>
      </Link>
      <nav className="app-nav flex-1 overflow-y-auto px-3 py-5" aria-label="Main">
        {GROUPS.map((group) => {
          const visibleItems = group.items.filter((i) => !i.adminOnly || role === "ADMIN");
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.title} className="mb-5">
              <div className="nav-group px-3 text-[0.68rem] font-semibold uppercase tracking-[0.08em] mb-1.5">
                {group.title}
              </div>
              {visibleItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(path, item.href) ? "page" : undefined}
                  className="nav-link block rounded-r-md px-3 py-1.5 text-sm"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

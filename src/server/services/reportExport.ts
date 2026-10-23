/**
 * Report registry + Excel / PDF rendering (SOP 8: every report exports to Excel and PDF).
 * Every report is expressed as one or more neutral ReportTables so the on-screen view,
 * the .xlsx and the .pdf always show the same numbers.
 */
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Action } from "@/server/policy";
import {
  agingReport,
  jobWorkReport,
  stockSummaryReport,
  rejectionReport,
  mrnStatusTable,
  scheduleVsDispatchTable,
  type ItemKind,
  type ReportTable,
} from "./reports";
import { issueRegisterTable, jwChallanTable, poRegisterTable } from "./registers";

export type ReportName =
  | "aging"
  | "jobwork"
  | "stock-summary"
  | "rejections"
  | "mrn-status"
  | "schedule-vs-dispatch"
  | "issue-register"
  | "po-register"
  | "jw-challan";

/** Section 9: Admin sees all reports; Floor sees stock, MRN and JW pending only. */
export const REPORT_ACCESS: Record<ReportName, Action> = {
  aging: "reports.viewAll",
  rejections: "reports.viewAll",
  "schedule-vs-dispatch": "reports.viewAll",
  jobwork: "reports.viewLimited",
  "stock-summary": "reports.viewLimited",
  "mrn-status": "reports.viewLimited",
  // Store's record of issues; PO register is exported by the IQC team; a challan is exported by whoever makes it.
  "issue-register": "reports.viewLimited",
  "po-register": "reports.viewLimited",
  "jw-challan": "jw.challan",
};

export function isReportName(s: string): s is ReportName {
  return s in REPORT_ACCESS;
}

type Params = Record<string, string | undefined>;

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function buildReport(name: ReportName, p: Params): Promise<ReportTable[]> {
  switch (name) {
    case "aging": {
      const type = (["RM", "WIP", "FG"].includes(p.type ?? "") ? p.type : "RM") as ItemKind;
      const r = await agingReport(parseDate(p.asOn, new Date()), type, {
        status: p.status || undefined,
        grade: p.grade || undefined,
        partNo: p.partNo || undefined,
        customer: p.customer || undefined,
      });
      return [r.table];
    }
    case "jobwork": {
      const r = await jobWorkReport(parseDate(p.asOn, new Date()));
      return [r.summary, r.detail];
    }
    case "stock-summary": {
      const to = parseDate(p.to, new Date());
      const from = parseDate(p.from, new Date(to.getTime() - 90 * 86400000));
      return [(await stockSummaryReport(from, to)).table];
    }
    case "rejections":
      return [(await rejectionReport({ stage: p.stage || undefined, disposal: p.disposal || undefined })).table];
    case "mrn-status":
      return [await mrnStatusTable()];
    case "schedule-vs-dispatch":
      return [await scheduleVsDispatchTable()];
    case "issue-register":
      return [
        await issueRegisterTable({
          from: p.from ? parseDate(p.from, new Date()) : undefined,
          to: p.to ? parseDate(p.to, new Date()) : undefined,
          q: p.q,
        }),
      ];
    case "po-register":
      return [
        await poRegisterTable({
          supplierId: p.supplierId || undefined,
          status: p.status === "OPEN" || p.status === "CLOSED" ? p.status : undefined,
          q: p.q,
        }),
      ];
    case "jw-challan":
      return [await jwChallanTable(p.challanId ?? "")];
  }
}

/** CSV (Excel-compatible, UTF-8 with BOM). Several tables are separated by their title line and a blank line. */
export function toCsv(tables: ReportTable[]): string {
  const cell = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const parts = tables.map((t) =>
    [
      cell(t.title),
      ...(t.subtitle ? t.subtitle.split(" | ").map(cell) : []),
      t.columns.map(cell).join(","),
      ...t.rows.map((r) => r.map(cell).join(",")),
    ].join("\r\n"),
  );
  return "﻿" + parts.join("\r\n\r\n") + "\r\n";
}

export async function toXlsx(tables: ReportTable[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Spring Inventory";
  wb.created = new Date();
  tables.forEach((t, i) => {
    const ws = wb.addWorksheet(sheetName(t.title, i));
    ws.addRow([t.title]).font = { bold: true, size: 14 };
    const subLines = t.subtitle ? t.subtitle.split(" | ") : [];
    for (const line of subLines) ws.addRow([line]).font = { italic: true };
    ws.addRow([]);
    const head = ws.addRow(t.columns);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
    });
    for (const r of t.rows) ws.addRow(r);
    t.columns.forEach((c, idx) => {
      const widest = Math.max(c.length, ...t.rows.map((r) => String(r[idx] ?? "").length));
      ws.getColumn(idx + 1).width = Math.min(40, widest + 2);
    });
    ws.views = [{ state: "frozen", ySplit: 3 + subLines.length }];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function sheetName(title: string, i: number): string {
  const clean = title.replace(/[\\/?*[\]:]/g, "-").slice(0, 28);
  return clean || `Sheet${i + 1}`;
}

export async function toPdf(tables: ReportTable[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842; // A4 landscape
  const H = 595;
  const M = 30;
  const rowH = 15;
  const fontSize = 8;

  // pdf-lib's standard fonts are WinAnsi only: replace anything outside it so encoding can't throw.
  const safe = (v: string | number) =>
    String(v ?? "")
      .replace(/[–—]/g, "-")
      .replace(/[^\x20-\x7E -ÿ]/g, "?");
  const fit = (text: string, width: number, f = font) => {
    let t = safe(text);
    while (t.length > 1 && f.widthOfTextAtSize(t, fontSize) > width - 4) t = t.slice(0, -1);
    return t.length < safe(text).length ? `${t.slice(0, -1)}.` : t;
  };

  for (const t of tables) {
    const colW = (W - 2 * M) / Math.max(1, t.columns.length);
    let page = pdf.addPage([W, H]);
    let y = H - M;
    const header = () => {
      page.drawText(fit(t.title, W - 2 * M, bold), { x: M, y, size: 13, font: bold });
      y -= 16;
      // " | " separates header lines (e.g. a challan's date / job worker / vehicle no.).
      for (const line of t.subtitle ? t.subtitle.split(" | ") : []) {
        page.drawText(fit(line, W - 2 * M), { x: M, y, size: 9, font });
        y -= 13;
      }
      if (t.subtitle) y -= 2;
      page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: rgb(0.12, 0.22, 0.39) });
      t.columns.forEach((c, i) =>
        page.drawText(fit(c, colW, bold), { x: M + i * colW + 2, y, size: fontSize, font: bold, color: rgb(1, 1, 1) }),
      );
      y -= rowH;
    };
    header();
    t.rows.forEach((r, ri) => {
      if (y < M + rowH) {
        page = pdf.addPage([W, H]);
        y = H - M;
        header();
      }
      if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: rgb(0.95, 0.95, 0.97) });
      r.forEach((cell, i) => page.drawText(fit(String(cell), colW), { x: M + i * colW + 2, y, size: fontSize, font }));
      y -= rowH;
    });
    if (t.rows.length === 0) page.drawText("No data.", { x: M, y, size: 9, font });
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 14, size: 7, font, color: rgb(0.4, 0.4, 0.4) }),
  );
  return pdf.save();
}

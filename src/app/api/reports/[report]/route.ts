import { NextResponse } from "next/server";
import { auth } from "@/server/auth/config";
import { can } from "@/server/policy";
import { buildReport, isReportName, REPORT_ACCESS, toCsv, toPdf, toXlsx } from "@/server/services/reportExport";
import { userMessage } from "@/server/userError";

export const runtime = "nodejs";

/** GET /api/reports/<name>?format=xlsx|pdf&...filters — authenticated, permission-checked server-side. */
export async function GET(req: Request, ctx: { params: Promise<{ report: string }> }) {
  const { report } = await ctx.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isReportName(report)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  if (!can({ id: session.user.id, role: session.user.role }, REPORT_ACCESS[report])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const format = params.format === "pdf" ? "pdf" : params.format === "csv" ? "csv" : "xlsx";
  let tables;
  try {
    tables = await buildReport(report, params);
  } catch (e) {
    // Plain message for the user; the details go to the server log.
    return new NextResponse(userMessage(e), { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    return new NextResponse(toCsv(tables), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report}-${stamp}.csv"`,
      },
    });
  }

  if (format === "pdf") {
    const bytes = await toPdf(tables);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report}-${stamp}.pdf"`,
      },
    });
  }
  const buf = await toXlsx(tables);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report}-${stamp}.xlsx"`,
    },
  });
}

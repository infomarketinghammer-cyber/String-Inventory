import { NextResponse } from "next/server";
import { auth } from "@/server/auth/config";
import { can } from "@/server/policy";
import { prisma } from "@/lib/prisma";
import { readReceipt } from "@/server/services/uploads";

export const runtime = "nodejs";

/** GET /api/grn/<id>/receipt — authenticated download of the receipt attached to a GRN. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can({ id: session.user.id, role: session.user.role }, "grn.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const grn = await prisma.grn.findUnique({ where: { id }, select: { receiptPath: true, receiptName: true, receiptMime: true } });
  if (!grn?.receiptPath || !grn.receiptMime) return NextResponse.json({ error: "No receipt attached" }, { status: 404 });
  try {
    const bytes = await readReceipt(grn.receiptPath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": grn.receiptMime,
        "Content-Disposition": `inline; filename="${(grn.receiptName ?? "receipt").replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return NextResponse.json({ error: "Receipt file is missing on the server" }, { status: 404 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/server/auth/config";
import { can } from "@/server/policy";
import { prisma } from "@/lib/prisma";
import { readDocument } from "@/server/services/uploads";

export const runtime = "nodejs";

/** GET /api/po/<id>/document — authenticated download of the scanned document attached to a PO. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can({ id: session.user.id, role: session.user.role }, "grn.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const po = await prisma.po.findUnique({ where: { id }, select: { documentPath: true, documentName: true, documentMime: true } });
  if (!po?.documentPath || !po.documentMime) return NextResponse.json({ error: "No document attached" }, { status: 404 });
  try {
    const bytes = await readDocument(po.documentPath, "po-documents");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": po.documentMime,
        "Content-Disposition": `inline; filename="${(po.documentName ?? "po-document").replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return NextResponse.json({ error: "Document file is missing on the server" }, { status: 404 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/server/auth/config";
import { can } from "@/server/policy";
import { ValidationError } from "@/server/services/errors";
import { validateDocument } from "@/server/services/uploads";
import { userMessage } from "@/server/userError";
import { poOcrEnabled, readPoDocument } from "@/server/services/poOcr";

export const runtime = "nodejs";

/**
 * POST /api/po/ocr (multipart, field "document") — AI reads a PO document and returns a proposal for the
 * New PO form. Nothing is saved; the user confirms/edits the values and saves the PO normally.
 * Same permission as adding a PO.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can({ id: session.user.id, role: session.user.role }, "masters.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!poOcrEnabled()) return NextResponse.json({ error: "AI PO reading is not configured." }, { status: 503 });

  try {
    const form = await req.formData();
    const file = form.get("document");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose the PO file first.");
    const { bytes, mime } = await validateDocument(file, "PO document");
    return NextResponse.json(await readPoDocument(bytes, mime));
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    // Details stay in the server log; the form shows a plain message.
    return NextResponse.json({ error: userMessage(e) }, { status: 500 });
  }
}

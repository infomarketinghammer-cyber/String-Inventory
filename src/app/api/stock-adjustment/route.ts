/**
 * Example API route (as opposed to a Server Action) demonstrating that the
 * Section 9 permission matrix is enforced at the route layer too, returning
 * a real HTTP 403 — not just a hidden UI button. See acceptance test #1.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth/config";
import { can } from "@/server/policy";
import { adjustBundleStock } from "@/server/services/adjustment";
import { ValidationError } from "@/server/services/errors";

const schema = z.object({ bundleId: z.string().min(1), deltaKg: z.number(), reason: z.string().min(1) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const user = { id: session.user.id, role: session.user.role };
  if (!can(user, "stock.adjust")) {
    return NextResponse.json({ error: "Forbidden: stock adjustment is Admin-only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    await adjustBundleStock({ ...parsed.data, adminId: user.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    // Never leak stack traces to the client.
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

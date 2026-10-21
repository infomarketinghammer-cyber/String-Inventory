"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { reverseTransaction } from "@/server/services/adjustment";
import { ValidationError } from "@/server/services/errors";

const schema = z.object({ ledgerId: z.string().min(1), reason: z.string().min(1) });

export async function reverseTransactionAction(formData: FormData) {
  const user = await requireAction("transaction.reverse"); // Admin-only
  const parsed = schema.safeParse({ ledgerId: formData.get("ledgerId"), reason: formData.get("reason") });
  if (!parsed.success) redirect(`/reversals?err=${encodeURIComponent("Please provide a reason.")}`);
  try {
    await reverseTransaction({ ...parsed.data, adminId: user.id });
    redirect(`/reversals?ok=${encodeURIComponent("Transaction reversed and audited.")}`);
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/reversals?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

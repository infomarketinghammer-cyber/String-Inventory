"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import argon2 from "argon2";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  current: z.string().min(1),
  next: z.string().min(8, "New password must be at least 8 characters."),
  confirm: z.string(),
});

export async function changePasswordAction(formData: FormData) {
  const user = await requireUser();
  const parsed = schema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  const back = (m: string): never => redirect(`/change-password?err=${encodeURIComponent(m)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Fill in all fields.");
  const { current, next, confirm } = parsed.data!;
  if (next !== confirm) back("New password and confirmation do not match.");
  if (next === current) back("Choose a password different from the current one.");

  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await argon2.verify(row.passwordHash, current).catch(() => false))) back("Current password is incorrect.");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await argon2.hash(next), forcePasswordChange: false },
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_CHANGED", entity: "User", entityId: user.id } });
  redirect("/dashboard");
}

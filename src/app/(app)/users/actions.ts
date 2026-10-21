"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import argon2 from "argon2";
import { requireAction } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["ADMIN", "FLOOR"]),
  password: z.string().min(8),
});

export async function createUserAction(formData: FormData) {
  const admin = await requireAction("users.manage");
  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(`/users?err=${encodeURIComponent("Invalid user details (password must be 8+ chars).")}`);

  const passwordHash = await argon2.hash(parsed.data.password);
  await prisma.user.create({
    data: { ...parsed.data, passwordHash, forcePasswordChange: true },
  });
  await prisma.auditLog.create({
    data: { userId: admin.id, action: "USER_CREATE", entity: "User", newValue: { email: parsed.data.email, role: parsed.data.role } },
  });
  redirect(`/users?ok=${encodeURIComponent(`User ${parsed.data.email} created.`)}`);
}

export async function toggleUserActiveAction(formData: FormData) {
  const admin = await requireAction("users.manage");
  const userId = String(formData.get("userId"));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({ where: { id: userId }, data: { active: !user.active } });
  await prisma.auditLog.create({
    data: { userId: admin.id, action: "USER_TOGGLE_ACTIVE", entity: "User", entityId: userId, oldValue: { active: user.active }, newValue: { active: !user.active } },
  });
  redirect(`/users?ok=${encodeURIComponent(`User ${user.email} ${!user.active ? "activated" : "deactivated"}.`)}`);
}

const resetSchema = z.object({ userId: z.string().min(1), newPassword: z.string().min(8) });
export async function resetPasswordAction(formData: FormData) {
  const admin = await requireAction("users.manage");
  const parsed = resetSchema.safeParse({ userId: formData.get("userId"), newPassword: formData.get("newPassword") });
  if (!parsed.success) redirect(`/users?err=${encodeURIComponent("Password must be at least 8 characters.")}`);
  const passwordHash = await argon2.hash(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { passwordHash, forcePasswordChange: true, failedLoginCount: 0, lockedUntil: null },
  });
  await prisma.auditLog.create({ data: { userId: admin.id, action: "USER_RESET_PASSWORD", entity: "User", entityId: parsed.data.userId } });
  redirect(`/users?ok=${encodeURIComponent("Password reset; user must change it at next login.")}`);
}

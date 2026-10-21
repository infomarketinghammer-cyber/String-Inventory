"use server";

import { signOut } from "@/server/auth/config";

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

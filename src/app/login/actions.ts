"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/server/auth/config";
import { AuthError } from "next-auth";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login?error=1");
    }
    throw err;
  }
}

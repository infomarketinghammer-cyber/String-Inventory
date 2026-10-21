import { redirect } from "next/navigation";
import { auth } from "./config";
import { can, type Action, type PolicyUser } from "@/server/policy";

/** Every page must call this; unauthenticated -> redirect to /login (mandatory rule). */
export async function requireUser(): Promise<PolicyUser & { name: string; email: string }> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return {
    id: session.user.id,
    role: session.user.role,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
  };
}

/** Every server action must call this before acting. Throws (never silently hides) on 403. */
export async function requireAction(action: Action) {
  const user = await requireUser();
  if (!can(user, action)) {
    throw new Error(`403 Forbidden: role ${user.role} may not perform "${action}"`);
  }
  return user;
}

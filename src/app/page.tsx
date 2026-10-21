import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";

export default async function RootPage() {
  const session = await auth();
  redirect(session?.user ? "/dashboard" : "/login");
}

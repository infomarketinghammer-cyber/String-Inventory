import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Sidebar } from "./Sidebar";
import { operationTabs } from "@/server/services/production";
import { logoutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Admin-created / reset accounts must set their own password before using anything else.
  // Read from the DB (not the JWT) so the flag clears as soon as the password is changed.
  // (Both lookups in one round trip: the account check and the Production sub-menu.)
  const [row, productionOps] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { forcePasswordChange: true, active: true } }),
    operationTabs(),
  ]);
  if (!row || !row.active) redirect("/login");
  if (row.forcePasswordChange) redirect("/change-password");

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  // App shell: the window itself never scrolls. The sidebar stays put and the main area scrolls on its own.
  return (
    <div className="app-shell flex overflow-hidden">
      <Sidebar role={user.role} productionOps={productionOps} />
      <div className="app-main flex-1 flex flex-col min-w-0 h-full">
        <header
          className="no-print flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          <span className="md:hidden font-semibold" style={{ color: "var(--brand-ink)" }}>
            Spring Inventory
          </span>
          <div className="hidden md:block text-sm" style={{ color: "var(--muted)" }}>
            Spring Manufacturing · Inventory Module
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)" }}
                aria-hidden
              >
                {initials || "U"}
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold">{user.name}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {user.role === "ADMIN" ? "Administrator" : "Floor user"}
                </div>
              </div>
            </div>
            <form action={logoutAction}>
              <button className="btn-secondary text-sm px-3 py-1.5" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="app-main flex-1 overflow-y-auto overflow-x-auto">
          <div className="mx-auto max-w-[1400px] p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

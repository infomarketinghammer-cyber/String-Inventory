import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Forbidden } from "@/components/Forbidden";
import { Banner } from "@/components/Banner";
import { formatDate } from "@/lib/format";
import { createUserAction, toggleUserActiveAction, resetPasswordAction } from "./actions";

export default async function UsersPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "users.manage")) return <Forbidden what="User Management" />;
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">User Management (Admin only)</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <form action={createUserAction} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <input aria-label="Full name" name="name" required placeholder="Full name" className="rounded border px-2 py-1.5 bg-transparent" />
        <input aria-label="Email" name="email" type="email" required placeholder="Email" className="rounded border px-2 py-1.5 bg-transparent" />
        <select aria-label="Role" name="role" required className="rounded border px-2 py-1.5 bg-transparent">
          <option value="FLOOR">Floor</option>
          <option value="ADMIN">Admin</option>
        </select>
        <input aria-label="Temp password" name="password" type="password" required placeholder="Temp password" className="rounded border px-2 py-1.5 bg-transparent" />
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Create user
        </button>
      </form>

      <div className="card p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th>Last login</th>
              <th>Reset password</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.active ? "Yes" : "No"}</td>
                <td>{u.lastLoginAt ? formatDate(u.lastLoginAt) : "-"}</td>
                <td>
                  <form action={resetPasswordAction} className="flex gap-1">
                    <input type="hidden" name="userId" value={u.id} />
                    <input aria-label="New password" name="newPassword" placeholder="New password" className="w-28 rounded border px-1 py-1 bg-transparent text-xs" />
                    <button type="submit" className="text-xs underline">
                      Reset
                    </button>
                  </form>
                </td>
                <td>
                  <form action={toggleUserActiveAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button type="submit" className="text-xs underline">
                      {u.active ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

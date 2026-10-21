import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { changePasswordAction } from "./actions";

export default async function ChangePasswordPage(props: { searchParams: Promise<{ err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const input = "w-full rounded border px-3 py-2 bg-transparent";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form action={changePasswordAction} className="card w-full max-w-sm p-8 space-y-3">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Signed in as {user.email}. You must choose your own password before continuing.
        </p>
        <Banner err={searchParams.err} />
        <input aria-label="Current (temporary) password" name="current" type="password" required autoComplete="current-password" placeholder="Current (temporary) password" className={input} />
        <input aria-label="New password (8+ characters)" name="next" type="password" required minLength={8} autoComplete="new-password" placeholder="New password (8+ characters)" className={input} />
        <input aria-label="Confirm new password" name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="Confirm new password" className={input} />
        <button type="submit" className="w-full btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Save password
        </button>
      </form>
    </div>
  );
}

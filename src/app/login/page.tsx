import { loginAction } from "./actions";

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const searchParams = await props.searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "radial-gradient(1200px 600px at 10% -10%, var(--accent-soft), transparent 60%), radial-gradient(900px 500px at 100% 110%, var(--brand-soft), transparent 60%), var(--bg)" }}>
      <div className="card w-full max-w-sm p-8 shadow-lg" style={{ borderTop: "4px solid var(--brand)" }}>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-semibold tracking-tight leading-tight">Spring Inventory</h1>
        </div>
        <p className="text-sm text-muted mb-6 mt-3" style={{ color: "var(--muted)" }}>
          Sign in to continue
        </p>
        {searchParams.error && (
          <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
            Invalid email or password, or your account is temporarily locked.
          </p>
        )}
        <form action={loginAction} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              className="w-full rounded border px-3 py-2 bg-transparent"
              placeholder="storekeeper@demo.local"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full rounded border px-3 py-2 bg-transparent"
              placeholder="Demo@1234"
            />
          </div>
          <button
            type="submit"
            className="w-full btn-primary py-2 font-medium"
          >
            Sign in
          </button>
        </form>
        <p className="mt-6 text-xs" style={{ color: "var(--muted)" }}>
          Demo credentials: any seeded user email, password <code>Demo@1234</code>. See README.
        </p>
      </div>
    </div>
  );
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { edgeAuth as auth } from "@/server/auth/edge";

const PUBLIC_PATHS = ["/login", "/api/auth"];

/**
 * Defense-in-depth: every request to a non-public path must carry a valid
 * session, or it is redirected to /login. This is in addition to (not a
 * replacement for) requireUser()/requireAction() inside each page/action,
 * which also enforce the Section 9 permission matrix server-side.
 */
export default auth((req: NextRequest & { auth?: unknown }) => {
  const isPublic = PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p));
  if (isPublic) return NextResponse.next();
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

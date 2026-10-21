/**
 * Edge-safe Auth.js config for middleware: no argon2 / Prisma imports.
 * It only verifies the JWT session cookie; credential checks live in config.ts.
 */
import NextAuth from "next-auth";

export const { auth: edgeAuth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  trustHost: true,
});

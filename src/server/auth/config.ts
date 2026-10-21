/**
 * Auth.js (NextAuth v5) configuration — Credentials provider, argon2 hashing,
 * JWT session in HTTP-only cookie, account lockout after 5 failed attempts
 * (15 min), 30 min idle timeout (maxAge on the JWT, refreshed on activity).
 */
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import argon2 from "argon2";
import { prisma } from "@/lib/prisma";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const IDLE_TIMEOUT_SECONDS = 30 * 60;

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "FLOOR";
      forcePasswordChange: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    role: "ADMIN" | "FLOOR";
    forcePasswordChange: boolean;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt", maxAge: IDLE_TIMEOUT_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase().trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) {
          await prisma.auditLog.create({
            data: { action: "LOGIN_FAILED", message: `Unknown or inactive user: ${email}`, success: false },
          });
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await prisma.auditLog.create({
            data: {
              userId: user.id,
              action: "LOGIN_BLOCKED_LOCKED",
              success: false,
              message: `Account locked until ${user.lockedUntil.toISOString()}`,
            },
          });
          return null;
        }

        const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
        if (!valid) {
          const failedCount = user.failedLoginCount + 1;
          const lockedUntil =
            failedCount >= LOCKOUT_THRESHOLD
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
              : null;
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: failedCount, lockedUntil },
          });
          await prisma.auditLog.create({
            data: { userId: user.id, action: "LOGIN_FAILED", success: false, message: "Bad password" },
          });
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });
        await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN_SUCCESS", success: true } });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          forcePasswordChange: user.forcePasswordChange,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.forcePasswordChange = user.forcePasswordChange;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.role = token.role as "ADMIN" | "FLOOR";
      session.user.forcePasswordChange = token.forcePasswordChange as boolean;
      return session;
    },
  },
});

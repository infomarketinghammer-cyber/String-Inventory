/**
 * Turns any failure into a message that is safe to show a user. Rule: technical details (database errors,
 * stack traces, internal names) never reach the screen. Business-rule messages (ValidationError) are shown
 * as written; a missing permission gets a plain sentence; anything else is logged on the server and the user
 * sees a generic message. Every action runs in a transaction, so a failed save changes nothing.
 */
import { unstable_rethrow } from "next/navigation";
import { NotFoundError, ValidationError } from "@/server/services/errors";
import { PolicyError } from "@/server/policy";

export const GENERIC_ERROR = "Something went wrong and nothing was saved. Please try again. If it keeps happening, contact the administrator.";
export const PERMISSION_ERROR = "You do not have permission to do this. Ask an Admin if you need access.";

export function userMessage(e: unknown): string {
  if (e instanceof ValidationError || e instanceof NotFoundError) return e.message;
  if (e instanceof PolicyError) return PERMISSION_ERROR;
  // Keep the details for the server log only.
  console.error("[unexpected error]", e);
  return GENERIC_ERROR;
}

/**
 * For a server action's catch block: lets Next.js redirects / not-found through untouched, and converts
 * everything else into a ValidationError carrying a user-safe message.
 */
export function toUserError(e: unknown): ValidationError {
  unstable_rethrow(e);
  return e instanceof ValidationError ? e : new ValidationError(userMessage(e));
}

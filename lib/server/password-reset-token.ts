import { createHmac } from "node:crypto";

/**
 * Password-reset tokens are stored as a keyed hash, never in clear: the
 * emailed link carries the 64-hex token, the table holds its HMAC, and the
 * reset looks the HMAC up. A copy of the table (backup, log, a browser role
 * that could read it before 20261005180000) no longer gives working links.
 *
 * Keyed with a server secret (3 Nov 2026): a plain SHA-256 could be worked
 * out by anyone, so a row planted in password_resets through the public
 * anon key (production still granted it INSERT then) would have reset any
 * account's password. Without the secret no planted row matches.
 * PASSWORD_RESET_SECRET when set, else the service-role key, which the
 * server already holds and never sends to a browser.
 *
 * Links issued before a change of key simply stop matching; they expire
 * within an hour anyway.
 */
export function hashResetToken(token: string): string {
  const secret = process.env.PASSWORD_RESET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("PASSWORD_RESET_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set");
  return createHmac("sha256", secret).update(`password-reset:${token}`).digest("hex");
}

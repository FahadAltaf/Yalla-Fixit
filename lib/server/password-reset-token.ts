import { createHash } from "node:crypto";

/**
 * Password-reset tokens are stored as their SHA-256, never in clear: the
 * emailed link carries the 64-hex token, the table holds its hash, and the
 * reset looks the hash up. A copy of the table (backup, log, a browser role
 * that could read it before 20261005180000) no longer gives working links.
 *
 * Links issued before this change were stored in clear and simply stop
 * matching; they expire within an hour anyway.
 */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(`password-reset:${token}`).digest("hex");
}

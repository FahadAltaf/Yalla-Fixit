import crypto from "crypto";

/**
 * Tokens for public client-report links (FR-5.04).
 *
 * The raw token travels in the URL and is shown to the coordinator once;
 * only its SHA-256 hash is stored, so the tokens table cannot be turned
 * back into working links if it leaks. `hint` (the last 6 chars) is kept
 * in the clear so a coordinator can recognise which link is which.
 */

export type MintedReportToken = { raw: string; hash: string; hint: string };

export function mintReportToken(): MintedReportToken {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashReportToken(raw), hint: raw.slice(-6) };
}

export function hashReportToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

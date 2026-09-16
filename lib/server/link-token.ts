import crypto from "crypto";

/**
 * Tokens for public, no-login client links.
 *
 * The raw token travels in the URL and the email; only its SHA-256 hash is
 * stored, so a leaked table cannot be turned back into working links. The
 * hint (last 6 characters) is kept in the clear so the team can tell which
 * link a client is quoting back at them without the database holding
 * anything usable.
 *
 * 32 random bytes is the unguessable part of NFR4 — 256 bits, so brute
 * force is not a consideration and the tokens need no rate limit of their
 * own beyond the platform's.
 *
 * This is the same construction as lib/server/snagging/report-token.ts,
 * which predates it. It lives here rather than being imported from the
 * snagging module because AMC has no business depending on snagging;
 * pointing snagging's copy at this file would be a tidy follow-up, but not
 * one to make in the middle of an unrelated phase.
 */

export type MintedLinkToken = { raw: string; hash: string; hint: string };

export function mintLinkToken(): MintedLinkToken {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashLinkToken(raw), hint: raw.slice(-6) };
}

export function hashLinkToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Default lifetime for a client link. Renewed whenever the document is
 *  re-sent, so an expired link is fixed by sending it again. */
export const LINK_TOKEN_TTL_DAYS = 30;

export function linkTokenExpiry(days = LINK_TOKEN_TTL_DAYS): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

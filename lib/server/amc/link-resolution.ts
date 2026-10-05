import { hashLinkToken } from "@/lib/server/link-token";
import { isLinkOpen, type LinkKind } from "@/lib/server/amc/public-dto";

/**
 * Turns a token from a client's link into a submission row and a verdict,
 * without knowing how rows are stored: the caller passes `lookup`, which
 * finds the row whose proposal or contract token hash equals the hash. The
 * route passes a Supabase query; tests pass a fake.
 *
 *   not_found  malformed token, or no row has this hash (never issued, or
 *              superseded by a newer send, which replaces the hash)
 *   expired    the matched link is past its expiry
 *   open       the document is waiting for the client: answers accepted
 *   closed     answered, signed, moved on, or reopened for changes: the
 *              outcome may be shown, the document and answers may not
 */
export interface LinkRow {
  id: string;
  status: string;
  proposal_token_hash: string | null;
  contract_token_hash: string | null;
  proposal_token_expires_at: string | null;
  contract_token_expires_at: string | null;
  [key: string]: unknown;
}

export type LinkResolution<R extends LinkRow> =
  | { state: "not_found" }
  | { state: "expired"; kind: LinkKind; row: R }
  | { state: "open" | "closed"; kind: LinkKind; row: R };

/** 32 random bytes in base64url are 43 characters; anything short is not ours. */
export const MIN_TOKEN_LENGTH = 32;

export async function resolveLink<R extends LinkRow>(
  token: string,
  lookup: (hash: string) => Promise<R | null>,
  now: number = Date.now(),
): Promise<LinkResolution<R>> {
  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH || token.length > 256) {
    return { state: "not_found" };
  }
  const hash = hashLinkToken(token);
  const row = await lookup(hash);
  if (!row) return { state: "not_found" };

  /* Which document the link is for is decided by which hash matched, never
     by anything the caller sends. */
  const kind: LinkKind = row.contract_token_hash === hash ? "contract" : "proposal";
  if (kind === "proposal" && row.proposal_token_hash !== hash) return { state: "not_found" };

  const expiresAt =
    kind === "contract" ? row.contract_token_expires_at : row.proposal_token_expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < now) {
    return { state: "expired", kind, row };
  }

  return { state: isLinkOpen(kind, row.status) ? "open" : "closed", kind, row };
}

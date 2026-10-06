import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signature on a customer's quotation review link.
 *
 * The public review page (/quotations/review?id=<Zoho estimate id>) used to
 * be authorised by the estimate id alone. Zoho ids are sequential numbers,
 * so anyone could read any quotation (prices, customer, address) and
 * approve or reject it in Zoho FSM. The link now also carries `sig`, an
 * HMAC of the estimate id made by the portal when the quotation is
 * emailed; the review page, its data and its approve/reject action all
 * require it.
 *
 * Keyed with QUOTATION_REVIEW_SIGNING_KEY when set, otherwise with the
 * service-role key (server-only either way). Changing the key invalidates
 * every review link already sent.
 */
function key(): string | undefined {
  return process.env.QUOTATION_REVIEW_SIGNING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || undefined;
}

export const ESTIMATE_ID = /^\d{1,25}$/;

export function signQuotationReview(estimateId: string, k: string | undefined = key()): string | null {
  if (!k || !ESTIMATE_ID.test(estimateId)) return null;
  return createHmac("sha256", k).update(`quotation-review:${estimateId}`).digest("hex").slice(0, 40);
}

export function verifyQuotationReview(estimateId: unknown, sig: unknown, k: string | undefined = key()): boolean {
  if (typeof estimateId !== "string" || typeof sig !== "string" || !/^[0-9a-f]{40}$/.test(sig)) return false;
  const expected = signQuotationReview(estimateId, k);
  if (!expected) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

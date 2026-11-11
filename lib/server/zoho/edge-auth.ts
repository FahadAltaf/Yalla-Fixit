import { createHmac } from "node:crypto";

/**
 * Headers for calling one of the Zoho Edge Functions from the portal's
 * server. The functions refuse any request that does not carry a fresh
 * signature for their own name (supabase/functions/_shared/internal-auth.ts):
 * an HMAC-SHA256 of "<slug>:<timestamp>" with ZOHO_EDGE_SIGNING_KEY, a
 * secret shared by this server and the Edge Function secrets, and never
 * sent itself. The anon key stays as the API gateway's apikey; it grants
 * nothing on its own.
 *
 * Server only. With no key configured the headers carry no signature and
 * the function answers 401, which surfaces as a clear configuration error
 * rather than a silent open door.
 */
export const ZOHO_EDGE_SIGNATURE_HEADER = "x-yfi-internal-signature";
export const ZOHO_EDGE_TIMESTAMP_HEADER = "x-yfi-internal-timestamp";

export function signZohoEdgeRequest(slug: string, now: number = Date.now(), key: string | undefined = process.env.ZOHO_EDGE_SIGNING_KEY): Record<string, string> {
  if (!key) return {};
  const timestamp = String(now);
  return {
    [ZOHO_EDGE_TIMESTAMP_HEADER]: timestamp,
    [ZOHO_EDGE_SIGNATURE_HEADER]: createHmac("sha256", key).update(`${slug}:${timestamp}`).digest("hex"),
  };
}

export function zohoEdgeHeaders(slug: string): Record<string, string> {
  const anon = process.env.SUPABASE_ANON_KEY ?? "";
  return {
    "Content-Type": "application/json",
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    ...signZohoEdgeRequest(slug),
  };
}

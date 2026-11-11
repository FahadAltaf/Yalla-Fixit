/**
 * Who may call the Zoho Edge Functions: the portal's own server, and
 * (token-refresher only) the scheduled job. Nobody else.
 *
 * Until 6 Oct 2026 every Zoho function ran with verify_jwt off and no check
 * of its own, so anyone who knew the URL could read FSM estimates, work
 * orders, contacts and addresses, or approve/cancel an estimate in FSM.
 *
 * The portal signs each request (lib/server/zoho/edge-functions.ts): an
 * HMAC-SHA256 of "<function slug>:<timestamp>" keyed with the shared secret
 * ZOHO_EDGE_SIGNING_KEY, sent as x-yfi-internal-timestamp and
 * x-yfi-internal-signature. A signature is good for one function and five
 * minutes. With no key configured every request is refused (fail closed).
 *
 * Deployment: set ZOHO_EDGE_SIGNING_KEY to the same random value in the
 * Edge Function secrets and in the portal's environment.
 */

export const SIGNATURE_HEADER = "x-yfi-internal-signature";
export const TIMESTAMP_HEADER = "x-yfi-internal-timestamp";
const MAX_SKEW_MS = 5 * 60 * 1000;

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the request carries a fresh, valid portal signature for `slug`. */
export async function isPortalRequest(req: Request, slug: string): Promise<boolean> {
  const key = Deno.env.get("ZOHO_EDGE_SIGNING_KEY");
  if (!key) return false;
  const timestamp = req.headers.get(TIMESTAMP_HEADER);
  const signature = req.headers.get(SIGNATURE_HEADER);
  if (!timestamp || !signature || !/^\d{10,16}$/.test(timestamp)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > MAX_SKEW_MS) return false;
  return constantTimeEqual(await hmacHex(key, `${slug}:${timestamp}`), signature.toLowerCase());
}

/** True when the request carries the scheduled job's secret (x-cron-secret). */
export function isCronRequest(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  const given = req.headers.get("x-cron-secret");
  return !!secret && !!given && constantTimeEqual(secret, given);
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** An error for the caller without upstream details (tokens, Zoho bodies, stack). */
export function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
}

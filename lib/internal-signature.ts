/**
 * Signs server-to-server requests the app makes to its own routes.
 *
 * Some server code still reaches a route over HTTP rather than calling it
 * in process (emailService.sendEmail -> /api/send-email). Those requests
 * carry no user session, so the route needs another way to tell "this is
 * our own server" from "this is someone on the internet".
 *
 * The signature is an HMAC of a purpose and a timestamp, keyed with the
 * service-role key. The key itself never leaves the server and is never
 * sent; a captured signature is only good for its own purpose and for
 * MAX_SKEW_MS. This file uses only Web Crypto so it can sit in modules
 * that are also bundled for the browser: there the key is undefined and
 * nothing is signed.
 */

export const INTERNAL_SIGNATURE_HEADER = "x-yfi-internal-signature";
export const INTERNAL_TIMESTAMP_HEADER = "x-yfi-internal-timestamp";

/** How old a signed request may be before it is refused. */
export const MAX_SKEW_MS = 5 * 60 * 1000;

function signingKey(): string | undefined {
  // Not NEXT_PUBLIC_: undefined in any browser bundle by construction.
  return process.env.SUPABASE_SERVICE_ROLE_KEY || undefined;
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(message),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Headers proving the request comes from this server, or {} when there is
 * no key (in the browser, or a misconfigured server).
 */
export async function internalRequestHeaders(
  purpose: string,
  now: number = Date.now(),
  key: string | undefined = signingKey(),
): Promise<Record<string, string>> {
  if (!key || typeof window !== "undefined") return {};
  const timestamp = String(now);
  return {
    [INTERNAL_TIMESTAMP_HEADER]: timestamp,
    [INTERNAL_SIGNATURE_HEADER]: await hmacHex(key, `${purpose}:${timestamp}`),
  };
}

/** True when the headers carry a fresh, valid signature for `purpose`. */
export async function verifyInternalRequest(
  headers: Pick<Headers, "get">,
  purpose: string,
  now: number = Date.now(),
  key: string | undefined = signingKey(),
): Promise<boolean> {
  if (!key) return false;
  const timestamp = headers.get(INTERNAL_TIMESTAMP_HEADER);
  const signature = headers.get(INTERNAL_SIGNATURE_HEADER);
  if (!timestamp || !signature || !/^\d{10,16}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return false;
  const expected = await hmacHex(key, `${purpose}:${timestamp}`);
  return constantTimeEqual(expected, signature.toLowerCase());
}

// Shared Zoho FSM REST client for the scheduling module.
//
// Replaces the zoho-fsm-* Supabase Edge Functions, which were thin proxies
// around this same API. Running them in the Next.js backend means one
// runtime, one deploy, and -- the reason that actually matters -- the FSM
// write paths now sit behind the portal's own auth instead of being
// reachable by anyone holding the public anon key.

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

export const FSM_BASE_URL = "https://fsm.zoho.com/fsm/v1";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

// The shape callEdgeFunction() used to return, kept deliberately identical so
// schedule-sync.ts and the route handlers keep their existing success/error
// handling (including describeError's `details` unwrapping).
export type FsmResult = { ok: boolean; status: number; json: any };

export function fsmOk(json: Record<string, unknown>, status = 200): FsmResult {
  return { ok: true, status, json };
}

export function fsmFail(error: string, status: number, extra?: Record<string, unknown>): FsmResult {
  return { ok: false, status, json: { error, ...extra } };
}

// Thrown when public.settings has no usable OAuth token. Callers turn this
// into a 500 rather than a 502, since it's a portal misconfiguration and not
// an FSM outage.
export class FsmConfigError extends Error {
  constructor(message = "Zoho FSM OAuth token is not configured") {
    super(message);
    this.name = "FsmConfigError";
  }
}

// The single shared OAuth access token (refreshed elsewhere by the existing
// zoho-token-refresh job) that every FSM call authenticates with.
export async function getFsmAccessToken(admin: Admin): Promise<string> {
  const { data, error } = await admin
    .from("settings")
    .select("oauth_access_token")
    .eq("id", 1)
    .single();

  if (error || !data?.oauth_access_token) throw new FsmConfigError();
  return data.oauth_access_token as string;
}

// Convenience for callers that don't already hold an admin client.
export async function getFsmContext() {
  const admin = await createAdminServerClient();
  const token = await getFsmAccessToken(admin);
  return { admin, token };
}

export function fsmAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Zoho-oauthtoken ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * How long one FSM call may take before it is abandoned.
 *
 * Node's fetch has NO default response timeout. Without this a hung Zoho
 * socket pins the calling request handler forever, and because several
 * paths fan out 8 calls at a time, a single slow tenant was enough to
 * accumulate handlers until the event loop and socket pool were exhausted.
 */
const FSM_TIMEOUT_MS = 20_000;

/** Attempts per call, including the first. */
const FSM_MAX_ATTEMPTS = 3;

/** Transient by nature: rate limiting and Zoho-side faults. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One FSM call. Never throws on a non-2xx -- returns the parsed body either
 * way so the caller can surface Zoho's own validation detail, which is what
 * the schedulers actually need to see when a sync fails.
 *
 * Retries a 429 or a 5xx with exponential backoff, honouring `Retry-After`
 * when Zoho sends one. FSM enforces per-minute and per-day API credits, and
 * before this a single 429 silently degraded a whole import into partial
 * data with nothing to say so. The pattern is the one already used in
 * app/api/zoho-file/route.ts; it simply was never applied to the shared
 * client every other call goes through.
 *
 * A timeout is surfaced as status 408 so callers keep their single
 * `{ ok, status, json }` shape rather than having to catch.
 */
export async function fsmFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= FSM_MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${FSM_BASE_URL}${path}`, {
        ...init,
        headers: { ...fsmAuthHeaders(token), ...(init?.headers ?? {}) },
        // FSM data is never cacheable for scheduling purposes -- a stale read
        // is exactly the failure mode the re-read-before-write logic exists
        // to stop.
        cache: "no-store",
        signal: AbortSignal.timeout(FSM_TIMEOUT_MS),
      });
    } catch (error) {
      // A timeout or a socket error. Retryable, but only so many times.
      lastError = error;
      if (attempt === FSM_MAX_ATTEMPTS) {
        return {
          ok: false,
          status: 408,
          json: {
            error: "FSM request timed out or the connection failed",
            detail: error instanceof Error ? error.message : String(error),
          },
        };
      }
      await sleep(Math.min(2 ** attempt * 500, 8_000));
      continue;
    }

    if (isRetryable(res.status) && attempt < FSM_MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : Math.min(2 ** attempt * 500, 8_000);
      await sleep(wait);
      continue;
    }

    // 204 is FSM's "no matching records" for search endpoints, not an error.
    if (res.status === 204) return { ok: res.ok, status: res.status, json: {} };

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  }

  // Only reachable if every attempt threw; the loop returns otherwise.
  return {
    ok: false,
    status: 408,
    json: {
      error: "FSM request failed",
      detail: lastError instanceof Error ? lastError.message : String(lastError),
    },
  };
}

// Read a single record from a module, returning the unwrapped `data[0]`.
export async function fsmGetRecord<T = any>(
  token: string,
  module: string,
  id: string,
): Promise<{ ok: boolean; status: number; record?: T; json: any }> {
  const res = await fsmFetch(token, `/${module}/${encodeURIComponent(id)}`);
  return { ...res, record: res.json?.data?.[0] as T | undefined };
}

// Turns an unexpected exception into the FsmResult shape callers expect.
export function fsmResultFromError(error: unknown, context: string): FsmResult {
  if (error instanceof FsmConfigError) return fsmFail(error.message, 500);
  console.error(`[${context}]`, error);
  const message = error instanceof Error ? error.message : "Unexpected error";
  return fsmFail(message, 500);
}

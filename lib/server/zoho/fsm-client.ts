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

// One FSM call. Never throws on a non-2xx -- returns the parsed body either
// way so the caller can surface Zoho's own validation detail, which is what
// the schedulers actually need to see when a sync fails.
export async function fsmFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${FSM_BASE_URL}${path}`, {
    ...init,
    headers: { ...fsmAuthHeaders(token), ...(init?.headers ?? {}) },
    // FSM data is never cacheable for scheduling purposes -- a stale read is
    // exactly the failure mode the re-read-before-write logic exists to stop.
    cache: "no-store",
  });

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

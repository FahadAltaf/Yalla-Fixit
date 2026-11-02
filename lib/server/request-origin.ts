/**
 * Cross-site request check for the portal's cookie-authenticated API.
 *
 * The browser sends the Supabase session cookie with every request to our
 * origin. Those cookies are SameSite=Lax, which already keeps them off
 * cross-site POSTs in current browsers; this is the second lock: a
 * state-changing request whose Origin header names another site is refused
 * before any route runs.
 *
 * Requests with no Origin header pass: our own server's fetches, cron jobs
 * and the mobile app send none, and authenticate in other ways (signed
 * headers, CRON_SECRET, bearer tokens). Edge-runtime safe: no Node APIs.
 */
export const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function crossSiteRejected(input: {
  method: string;
  origin: string | null;
  host: string | null;
  appUrl?: string | null;
}): boolean {
  if (!STATE_CHANGING.has(input.method.toUpperCase())) return false;
  if (!input.origin || input.origin === "null") return input.origin === "null";
  let originHost: string;
  try {
    originHost = new URL(input.origin).host.toLowerCase();
  } catch {
    return true;
  }
  const allowed = new Set<string>();
  if (input.host) allowed.add(input.host.toLowerCase());
  if (input.appUrl) {
    try {
      allowed.add(new URL(input.appUrl).host.toLowerCase());
    } catch {
      /* a malformed setting adds nothing */
    }
  }
  return !allowed.has(originHost);
}

/**
 * A small fixed-window limiter, per server instance (in memory).
 *
 * The project has no shared rate-limit store; this blunts scripted abuse of
 * the public endpoints from one instance (guessing tokens, mass sign
 * attempts, mail floods) without new infrastructure. It is not a global
 * guarantee across instances: see docs/amc-security-hardening-report.md.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimited(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return false;
  }
  w.count += 1;
  return w.count > limit;
}

/** The caller's address as the proxy reports it, for rate-limit keys only. */
export function clientAddress(headers: Pick<Headers, "get">): string {
  return (headers.get("x-forwarded-for")?.split(",")[0] ?? headers.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

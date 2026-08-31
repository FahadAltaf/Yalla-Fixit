import { NextRequest, NextResponse } from "next/server";

/**
 * CORS for the snagging API.
 *
 * The inspector app calls these routes from another origin — the Expo
 * web build in the browser, and eventually the packaged app. Those calls
 * authenticate with a bearer token in the Authorization header, never a
 * cookie, so opening the routes cross-origin exposes nothing that the
 * token itself does not already gate. The portal's own pages are
 * same-origin and unaffected.
 *
 * Preflight (OPTIONS) is answered here directly; every other response to
 * a snagging route gets the same allow headers stamped on it.
 */
const ALLOW_HEADERS = "authorization, content-type, x-client-info, apikey";
const ALLOW_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    // Reflect the caller's origin so the response is valid without
    // credentials; fall back to "*" for tools that send no Origin.
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const res = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    res.headers.set(key, value);
  }
  return res;
}

export const config = {
  matcher: ["/api/snagging/:path*"],
};

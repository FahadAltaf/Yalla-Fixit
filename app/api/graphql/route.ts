import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/**
 * pg_graphql, for the browser only.
 *
 * This forwards a caller-supplied query to Supabase using the project's anon
 * key, so whoever reaches it can author arbitrary reads. It was unauthenticated
 * and live: an anonymous POST to the production host returned 200.
 *
 * It now requires a signed-in session. Server-side callers do not come through
 * here at all -- `lib/graphql-server.ts` talks to Supabase directly when it is
 * not running in a browser, which is what lets this route demand a session
 * without breaking `app/auth/callback/route.ts`, where a user is resolved
 * before any cookie exists.
 *
 * Still deliberately not offered: depth and complexity limits. Everything this
 * key can read is behind RLS, and the session check removes the anonymous
 * amplification, but a signed-in user can still author an expensive query.
 * Bound it here if this is ever exposed more widely.
 */
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { query, variables } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const response = await fetch(`${process.env.SUPABASE_URL}/graphql/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ query, variables }),
      // Node's fetch has no response timeout of its own.
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: error.message || "GraphQL query failed" },
        { status: response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json({ data: result.data, errors: result.errors });
  } catch (error: unknown) {
    console.error("GraphQL API Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

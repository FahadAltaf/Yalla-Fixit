import { NextRequest, NextResponse } from "next/server";

import { allowedGraphQLOperation } from "@/lib/server/graphql-allowlist";

/**
 * pg_graphql, for the browser.
 *
 * Forwards the query to Supabase with the project's anon key. It asks for
 * no session, because a page shown before sign-in calls it (the portal's
 * settings), so it forwards only the queries on the allowlist
 * (lib/server/graphql-allowlist.ts) and refuses anything else (3 Nov 2026,
 * Sami's report). Open, it let a signed-out visitor list the roles and
 * read, grant or remove any permission with a query of their own. The
 * login screen's email check no longer comes here (/api/auth/check-email).
 *
 * Server-side callers do not come through here -- `lib/graphql-server.ts`
 * talks to Supabase directly when it is not running in a browser.
 */
export async function POST(req: NextRequest) {
  try {
    const { query, variables } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }
    if (!allowedGraphQLOperation(query, variables)) {
      return NextResponse.json({ error: "Query not allowed" }, { status: 403 });
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
      const message = error.message || error.error || "GraphQL query failed";
      // Logged here because the browser only ever sees the status code.
      console.error(`GraphQL upstream ${response.status}:`, message, "query:", String(query).trim().slice(0, 80));
      return NextResponse.json({ error: message }, { status: response.status });
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

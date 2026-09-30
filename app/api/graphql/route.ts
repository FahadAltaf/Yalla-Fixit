import { NextRequest, NextResponse } from "next/server";

/**
 * pg_graphql, for the browser.
 *
 * Forwards the query to Supabase with the project's anon key, so what it
 * can read is whatever row-level security allows the anon role. It asks
 * for no session: pages used before sign-in (the login screen's email
 * check among them) call it too, and requiring one stopped every sign-in
 * at "HTTP error! status: 401".
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

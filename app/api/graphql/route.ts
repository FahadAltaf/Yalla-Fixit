import { NextRequest, NextResponse } from "next/server";

import { allowedGraphQLOperation } from "@/lib/server/graphql-allowlist";

/**
 * pg_graphql, for the browser: ONE known query, nothing else.
 *
 * This forwarded any query or mutation to Supabase with the anon key and
 * no session, which made it a public, unauthenticated door to every table
 * the anon role could reach: users, roles, permission rows, settings.
 * Every portal feature that used it now has an authenticated API
 * (/api/users, /api/roles, /api/role-access, /api/settings/appearance).
 *
 * What remains is the branding read the sign-in page needs before anyone
 * is signed in (AuthContext -> settingsService.getSettingsById), and it is
 * the only document accepted: a persisted-query allowlist, compared after
 * whitespace is collapsed. Its columns are the branding ones the anon role
 * may read (migration 20261005160000). Anything else gets 400.
 */

export async function POST(req: NextRequest) {
  try {
    const { query, variables } = await req.json().catch(() => ({}) as Record<string, unknown>);
    if (!allowedGraphQLOperation(query, variables)) {
      return NextResponse.json({ error: "This query is not allowed" }, { status: 400 });
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
      return NextResponse.json({ error: "GraphQL query failed" }, { status: 502 });
    }

    const result = await response.json();
    return NextResponse.json({ data: result.data, errors: result.errors });
  } catch (error: unknown) {
    console.error("GraphQL API Error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

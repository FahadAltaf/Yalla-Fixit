import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { query, variables } = await req.json();

    // Validate the request
    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    // Execute the GraphQL query using Supabase's REST API
    const response = await fetch(
      `${process.env.SUPABASE_URL}/graphql/v1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.message || "GraphQL query failed" },
        { status: response.status }
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
      { status: 500 }
    );
  }
}

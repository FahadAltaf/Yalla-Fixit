// app/api/fsm/bulk-download/route.ts
//
// Thin proxy to Supabase Edge Function.
// Returns JSON work order info — frontend handles file downloads directly.

import { NextRequest, NextResponse } from "next/server";

const EDGE_FUNCTION_URL = `${process.env.SUPABASE_URL}/functions/v1/zoho-fsm-work-orders`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; comparator?: string };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Missing field: name" }, { status: 400 });
    }

    const edgeRes = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        name:       body.name.trim(),
        comparator: body.comparator ?? "equal",
      }),
    });

    const data = await edgeRes.json();

    return NextResponse.json(data, { status: edgeRes.status });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    console.error("[bulk-download route]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
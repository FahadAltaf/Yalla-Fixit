import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Missing field: name" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "Supabase staging environment is not configured" },
        { status: 500 },
      );
    }

    const edgeResponse = await fetch(
      `${supabaseUrl}/functions/v1/zoho-fsm-appointments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      },
    );

    const responseText = await edgeResponse.text();
    let responseBody: unknown;

    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = {
        error: "The appointments function returned an invalid response",
      };
    }

    return NextResponse.json(responseBody, { status: edgeResponse.status });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unable to search appointments";

    console.error("[appointments route]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

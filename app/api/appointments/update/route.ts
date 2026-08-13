import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "Supabase staging environment is not configured" },
        { status: 500 },
      );
    }

    const edgeResponse = await fetch(
      `${supabaseUrl}/functions/v1/zoho-fsm-appointment-update`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const responseText = await edgeResponse.text();
    let responseBody: unknown;

    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { error: "The appointment-update function returned an invalid response" };
    }

    return NextResponse.json(responseBody, { status: edgeResponse.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to update appointment";
    console.error("[appointments/update route]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

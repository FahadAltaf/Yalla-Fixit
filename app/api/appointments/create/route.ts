import { NextRequest, NextResponse } from "next/server";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

export async function POST(request: NextRequest) {
  try {
    /*
      Authorised like any other route.

      These proxied an Edge Function using the server's anon key with no
      permission check of their own -- the same anti-pattern already fixed in
      app/api/service-resources/route.ts. Callers are the browser, which
      carries the session cookie.
    */
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
      `${supabaseUrl}/functions/v1/zoho-fsm-appointment-create`,
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
      responseBody = { error: "The appointment-create function returned an invalid response" };
    }

    return NextResponse.json(responseBody, { status: edgeResponse.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to create appointment";
    console.error("[appointments/create route]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

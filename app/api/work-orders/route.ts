// app/api/fsm/bulk-download/route.ts
//
// Thin proxy to Supabase Edge Function.
// Returns JSON work order info — frontend handles file downloads directly.

import { NextRequest, NextResponse } from "next/server";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const EDGE_FUNCTION_URL = `${process.env.SUPABASE_URL}/functions/v1/zoho-fsm-work-orders`;

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
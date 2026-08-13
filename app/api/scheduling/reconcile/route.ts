import { NextResponse } from "next/server";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// SYNC-013: manual refresh/reconcile action for authorised users -- calls
// the same Edge Function the pg_cron job uses on a schedule.
export async function POST() {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase staging environment is not configured" }, { status: 500 });
    }

    const edgeResponse = await fetch(`${supabaseUrl}/functions/v1/zoho-fsm-reconcile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
    });

    const responseText = await edgeResponse.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { error: "The reconcile function returned an invalid response" };
    }

    return NextResponse.json(responseBody, { status: edgeResponse.status });
  } catch (error) {
    console.error("Scheduling reconcile error:", error);
    return NextResponse.json({ error: "Failed to trigger reconciliation" }, { status: 500 });
  }
}

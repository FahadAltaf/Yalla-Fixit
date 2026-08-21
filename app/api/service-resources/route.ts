import { NextResponse } from "next/server";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { syncFsmTechnicians } from "@/lib/server/zoho/service-resources";
import { ActionType, ResourceType } from "@/types/types";

// Pages up to 2000 FSM users, so allow more than the platform default.
export const maxDuration = 60;

// SYNC-013: explicit "Refresh technicians" action. Pulls the roster from Zoho
// FSM and reconciles public.technician_reference.
//
// This used to proxy an Edge Function callable with the public anon key, and
// carried no permission check of its own. It is now a normal authorised route.
export async function POST() {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await syncFsmTechnicians();
    if (!result.ok) return NextResponse.json(result.json, { status: result.status });

    return NextResponse.json({ data: result.json });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to fetch service resources";
    console.error("[service-resources route]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

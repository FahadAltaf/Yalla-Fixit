import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// AUD-002/AUD-003: material user/system activity for a schedule version --
// creation, edits, submissions, approvals, rejections, sync outcomes, and
// detected FSM-originated changes.
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scheduleVersionId = req.nextUrl.searchParams.get("scheduleVersionId");
    if (!scheduleVersionId) {
      return NextResponse.json({ error: "Missing field: scheduleVersionId" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: events, error } = await admin
      .from("schedule_audit_events")
      .select("*, user_profile(full_name, email)")
      .eq("schedule_version_id", scheduleVersionId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: syncOps, error: syncError } = await admin
      .from("schedule_sync_operations")
      .select("*")
      .eq("schedule_version_id", scheduleVersionId)
      .order("created_at", { ascending: false });
    if (syncError) throw new Error(syncError.message);

    return NextResponse.json({ data: { events: events ?? [], syncOperations: syncOps ?? [] } });
  } catch (error) {
    console.error("Scheduling audit GET error:", error);
    return NextResponse.json({ error: "Failed to load audit history" }, { status: 500 });
  }
}

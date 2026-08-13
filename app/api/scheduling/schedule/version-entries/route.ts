import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// E6: read-only appointments of a specific (possibly historical) version, so
// the history panel can show what a previous version of the day looked like.
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
      return NextResponse.json({ error: "scheduleVersionId is required" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("schedule_entries")
      .select("*, schedule_entry_assignments(technician_fsm_id, technician_reference(display_name))")
      .eq("schedule_version_id", scheduleVersionId)
      .order("shift", { ascending: true })
      .order("start_at", { ascending: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("Version entries GET error:", error);
    return NextResponse.json({ error: "Failed to load version appointments" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// AUD-001/AUD-004: authorised users can view every version of a daily
// schedule, including historical ones, without editing them.
//
// Versions now carry schedule_date directly, so this no longer resolves a
// daily_schedules row first. The per-version approval trail comes from
// /api/scheduling/audit rather than a separate approval-actions table.
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const date = req.nextUrl.searchParams.get("date");
    if (!date) return NextResponse.json({ error: "Missing field: date" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { data: versions, error: versionsError } = await admin
      .from("schedule_versions")
      .select("*")
      .eq("schedule_date", date)
      .order("version_number", { ascending: false });
    if (versionsError) throw new Error(versionsError.message);

    return NextResponse.json({ data: versions ?? [] });
  } catch (error) {
    console.error("Scheduling history GET error:", error);
    return NextResponse.json({ error: "Failed to load schedule history" }, { status: 500 });
  }
}

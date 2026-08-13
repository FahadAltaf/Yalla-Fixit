import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// AUD-001/AUD-004: authorised users can view every version of a daily
// schedule, including historical ones, without editing them.
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
    const { data: dailySchedule, error: dsError } = await admin
      .from("daily_schedules")
      .select("id")
      .eq("schedule_date", date)
      .maybeSingle();
    if (dsError) throw new Error(dsError.message);
    if (!dailySchedule) return NextResponse.json({ data: [] });

    const { data: versions, error: versionsError } = await admin
      .from("schedule_versions")
      .select(
        "*, schedule_approval_actions(id, action, actor_id, comment, created_at, user_profile(full_name, email))",
      )
      .eq("daily_schedule_id", dailySchedule.id)
      .order("version_number", { ascending: false });
    if (versionsError) throw new Error(versionsError.message);

    return NextResponse.json({ data: versions ?? [] });
  } catch (error) {
    console.error("Scheduling history GET error:", error);
    return NextResponse.json({ error: "Failed to load schedule history" }, { status: 500 });
  }
}

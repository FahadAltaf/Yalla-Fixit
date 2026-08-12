import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// DASH-001/PLAN-002: load (or create, for current/future dates) the daily
// schedule and its current version, with entries and assignments, for the
// selected operating date.
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
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Missing or invalid field: date (YYYY-MM-DD)" }, { status: 400 });
    }

    const admin = await createAdminServerClient();

    const { data: dsRow, error: dsError } = await admin
      .from("daily_schedules")
      .select("*")
      .eq("schedule_date", date)
      .maybeSingle();
    if (dsError) throw new Error(dsError.message);
    let dailySchedule = dsRow;

    const today = new Date().toISOString().slice(0, 10);
    const isPastDate = date < today;

    if (!dailySchedule) {
      // BR-016: past dates are read-only and never auto-create a draft.
      if (isPastDate) {
        return NextResponse.json({ data: { dailySchedule: null, version: null, entries: [] } });
      }

      const { data: created, error: createError } = await admin
        .from("daily_schedules")
        .insert({ schedule_date: date })
        .select("*")
        .single();
      if (createError) throw new Error(createError.message);
      dailySchedule = created;

      const { data: version, error: versionError } = await admin
        .from("schedule_versions")
        .insert({
          daily_schedule_id: dailySchedule.id,
          version_number: 1,
          status: "draft",
          created_by: profile.id,
        })
        .select("*")
        .single();
      if (versionError) throw new Error(versionError.message);

      await admin
        .from("daily_schedules")
        .update({ current_version_id: version.id })
        .eq("id", dailySchedule.id);
      dailySchedule.current_version_id = version.id;

      await admin.from("schedule_audit_events").insert({
        event_type: "draft_created",
        actor_id: profile.id,
        origin: "portal",
        schedule_date: date,
        schedule_version_id: version.id,
      });

      return NextResponse.json({ data: { dailySchedule, version, entries: [] } });
    }

    const { data: version, error: versionError } = await admin
      .from("schedule_versions")
      .select("*")
      .eq("id", dailySchedule.current_version_id)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);

    const { data: entries, error: entriesError } = await admin
      .from("schedule_entries")
      .select(
        "*, schedule_entry_assignments(id, technician_fsm_id, technician_reference(display_name)), " +
          "created_by_user:user_profile!schedule_entries_created_by_fkey(full_name, email), " +
          "updated_by_user:user_profile!schedule_entries_updated_by_fkey(full_name, email)",
      )
      .eq("schedule_version_id", version?.id ?? "00000000-0000-0000-0000-000000000000")
      .order("shift", { ascending: true })
      .order("start_at", { ascending: true });
    if (entriesError) throw new Error(entriesError.message);

    return NextResponse.json({ data: { dailySchedule, version, entries: entries ?? [] } });
  } catch (error) {
    console.error("Schedule GET error:", error);
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}

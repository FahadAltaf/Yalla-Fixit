import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { importFsmAppointmentsForDay } from "@/lib/server/zoho/import-appointments";
import { DEFAULT_ORG_TIMEZONE, todayInZone } from "@/lib/scheduling/org-time";
import { ActionType, ResourceType } from "@/types/types";

// FR-4 reads the day's appointments from FSM the first time a day is opened,
// which can take a few seconds on a busy date.
export const maxDuration = 60;

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

    // The day IS its current version now -- there is no separate
    // daily_schedules row, and no current_version_id pointer to keep in step
    // with is_current. BR-017's partial unique index guarantees at most one.
    const { data: currentRow, error: currentError } = await admin
      .from("schedule_versions")
      .select("*")
      .eq("schedule_date", date)
      .eq("is_current", true)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    let version = currentRow;

    if (!version) {
      // BR-016: past dates are read-only and never auto-create a draft.
      // "Today" is the ORG's date, not the server's: a UTC host is still on
      // yesterday until 04:00 Gulf time, and would refuse to open today's draft.
      const { data: zoneRow } = await admin.from("settings").select("org_timezone").eq("id", 1).maybeSingle();
      const today = todayInZone(zoneRow?.org_timezone || DEFAULT_ORG_TIMEZONE);
      if (date < today) {
        return NextResponse.json({ data: { version: null, entries: [] } });
      }

      const { data: created, error: createError } = await admin
        .from("schedule_versions")
        .insert({
          schedule_date: date,
          version_number: 1,
          status: "draft",
          created_by: profile.id,
        })
        .select("*")
        .single();
      if (createError) throw new Error(createError.message);
      version = created;

      await admin.from("schedule_audit_events").insert({
        event_type: "draft_created",
        actor_id: profile.id,
        origin: "portal",
        schedule_date: date,
        schedule_version_id: version.id,
      });
    }

    // FR-4: pull appointments booked directly in FSM onto the board. Done once
    // per version (Refresh re-runs it), and only while the day is still
    // editable -- an approved day's entry list is fixed.
    let imported = 0;
    let fsmImport: Awaited<ReturnType<typeof importFsmAppointmentsForDay>> | null = null;
    const editable = version.status === "draft" || version.status === "draft_revision";
    if (editable && !version.fsm_imported_at) {
      const result = await importFsmAppointmentsForDay(admin, { date, versionId: version.id });
      fsmImport = result;
      imported = result.imported;
      if (!result.error) {
        const stamp = new Date().toISOString();
        // If the column isn't there yet (migration not applied), this just
        // fails quietly and the import runs again next time.
        await admin.from("schedule_versions").update({ fsm_imported_at: stamp }).eq("id", version.id);
        version = { ...version, fsm_imported_at: stamp };
      }
    }

    const { data: entries, error: entriesError } = await admin
      .from("schedule_entries")
      .select(
        "*, schedule_entry_assignments(id, technician_fsm_id, technician_reference(display_name)), " +
          "created_by_user:user_profile!schedule_entries_created_by_fkey(full_name, email), " +
          "updated_by_user:user_profile!schedule_entries_updated_by_fkey(full_name, email)",
      )
      .eq("schedule_version_id", version.id)
      .order("shift", { ascending: true })
      .order("start_at", { ascending: true });
    if (entriesError) throw new Error(entriesError.message);

    return NextResponse.json({ data: { version, entries: entries ?? [], imported, fsmImport } });
  } catch (error) {
    console.error("Schedule GET error:", error);
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}

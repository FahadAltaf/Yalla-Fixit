import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import {
  importFsmAppointmentsForDay,
  readUnplacedAppointments,
  type UnplacedAppointment,
} from "@/lib/server/zoho/import-appointments";
import { reconcileFsmAppointments } from "@/lib/server/zoho/reconcile";
import {
  DEFAULT_ORG_TIMEZONE,
  addDaysToDateString,
  todayInZone,
  zonedTimeToUtc,
} from "@/lib/scheduling/org-time";
import { ActionType, ResourceType } from "@/types/types";

// FR-4 reads the day's appointments from FSM the first time a day is opened,
// which can take a few seconds on a busy date.
export const maxDuration = 60;

// How long a day may go without being re-read from FSM. Appointments are
// booked and completed all day, so "pull once" left whole days empty and
// statuses stale; this keeps the day being looked at in step, at the cost of
// one FSM round at most every few minutes -- and only while someone is looking.
const FSM_REFRESH_MINUTES = 5;

// How far back to look for a job that is still running on the day shown.
const CARRY_OVER_DAYS = 7;

const ENTRY_SELECT =
  "*, schedule_entry_assignments(id, technician_fsm_id, technician_reference(display_name)), " +
  "created_by_user:user_profile!schedule_entries_created_by_fkey(full_name, email), " +
  "updated_by_user:user_profile!schedule_entries_updated_by_fkey(full_name, email)";

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
    const { data: zoneRow } = await admin.from("settings").select("org_timezone").eq("id", 1).maybeSingle();
    const timeZone = zoneRow?.org_timezone || DEFAULT_ORG_TIMEZONE;

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
      const today = todayInZone(timeZone);
      if (date < today) {
        return NextResponse.json({ data: { version: null, entries: [], carriedOver: [], unplaced: [] } });
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

    // FR-4: keep the day in step with Zoho FSM. New appointments are pulled in
    // while the day is still editable (an approved day's entry list is fixed);
    // statuses, times and crews of what is already on the board are refreshed
    // either way.
    let imported = 0;
    let fsmImport: Awaited<ReturnType<typeof importFsmAppointmentsForDay>> | null = null;
    let fsmFirstPull = false;
    const editable = version.status === "draft" || version.status === "draft_revision";
    const lastPull = version.fsm_imported_at ? new Date(version.fsm_imported_at).getTime() : 0;
    if (Date.now() - lastPull > FSM_REFRESH_MINUTES * 60_000) {
      // Claim the refresh before running it, so two people opening the day at
      // once (or the wall display's poll) don't both run it.
      const stamp = new Date().toISOString();
      const threshold = new Date(Date.now() - FSM_REFRESH_MINUTES * 60_000).toISOString();
      const { data: claimed, error: claimError } = await admin
        .from("schedule_versions")
        .update({ fsm_imported_at: stamp })
        .eq("id", version.id)
        .or(`fsm_imported_at.is.null,fsm_imported_at.lt."${threshold}"`)
        .select("id");
      // No fsm_imported_at column yet (migration not applied): still pull,
      // just without the throttle.
      if (claimError || (claimed?.length ?? 0) > 0) {
        fsmFirstPull = !version.fsm_imported_at;
        if (editable) {
          fsmImport = await importFsmAppointmentsForDay(admin, { date, versionId: version.id });
          imported = fsmImport.imported;
        }
        await reconcileFsmAppointments({ operatingDate: date });
        if (!claimError) version = { ...version, fsm_imported_at: stamp };
      }
    }

    const { data: entries, error: entriesError } = await admin
      .from("schedule_entries")
      .select(ENTRY_SELECT)
      .eq("schedule_version_id", version.id)
      .order("shift", { ascending: true })
      .order("start_at", { ascending: true });
    if (entriesError) throw new Error(entriesError.message);

    // A job that started on an earlier day and is still running on this one
    // (22:00 -> 04:00) belongs to that day's schedule, so this day never
    // showed it and its technicians looked free until it ended. It is sent
    // along, marked, to be drawn but not edited here.
    let carriedOver: Record<string, unknown>[] = [];
    const dayStart = zonedTimeToUtc(date, "00:00:00", timeZone).toISOString();
    const { data: carriedRows, error: carriedError } = await admin
      .from("schedule_entries")
      .select(`${ENTRY_SELECT}, schedule_versions!inner(is_current)`)
      .eq("schedule_versions.is_current", true)
      .lt("operating_date", date)
      .gte("operating_date", addDaysToDateString(date, -CARRY_OVER_DAYS))
      .gt("end_at", dayStart)
      .order("start_at", { ascending: true });
    if (carriedError) {
      // Never a reason to fail the day itself.
      console.error("Schedule GET carried-over error:", carriedError.message);
    } else {
      // An appointment FSM moved onto this date is already here as this day's own entry.
      const own = new Set(
        ((entries ?? []) as unknown as Array<{ fsm_appointment_id: string | null }>)
          .map((e) => e.fsm_appointment_id)
          .filter((id): id is string => Boolean(id)),
      );
      carriedOver = ((carriedRows ?? []) as unknown as Array<Record<string, unknown>>)
        .filter((row) => !row.fsm_appointment_id || !own.has(row.fsm_appointment_id as string))
        .map((row) => {
          const { schedule_versions: _version, ...entry } = row;
          void _version;
          return { ...entry, carried_over: true };
        });
    }

    // FSM appointments for the date with nobody to draw them on. Only while
    // the day still takes new bookings; an approved day's list is fixed.
    let unplaced: UnplacedAppointment[] = [];
    if (editable) {
      unplaced =
        fsmImport && !fsmImport.error
          ? (fsmImport.unplaced ?? [])
          : await readUnplacedAppointments(admin, version.id);
    }

    return NextResponse.json({
      data: { version, entries: entries ?? [], carriedOver, unplaced, imported, fsmImport, fsmFirstPull },
    });
  } catch (error) {
    console.error("Schedule GET error:", error);
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}

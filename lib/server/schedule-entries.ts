// Helpers shared by the schedule entry routes.
//
// Route files may only export handlers, so anything two routes need lives
// here. Kept small and free of request handling.

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { todayInZone } from "@/lib/scheduling/org-time";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

export type LeaveConflict = {
  id: string;
  technician_fsm_id: string;
  leave_type: string;
  start_at: string;
  end_at: string;
  technician_reference?: { display_name?: string } | { display_name?: string }[] | null;
};

// LEAVE-010/PLAN-021: the active leave records that overlap a window, for the
// given technicians.
export async function findLeaveConflicts(
  admin: Admin,
  technicianFsmIds: string[],
  startAt: string,
  endAt: string,
): Promise<LeaveConflict[]> {
  if (technicianFsmIds.length === 0) return [];
  const { data, error } = await admin
    .from("leave_records")
    .select("id, technician_fsm_id, leave_type, start_at, end_at, technician_reference(display_name)")
    .in("technician_fsm_id", technicianFsmIds)
    .eq("status", "active")
    .lt("start_at", endAt)
    .gt("end_at", startAt);
  if (error) throw new Error(error.message);
  return (data ?? []) as LeaveConflict[];
}

export function leaveConflictName(conflict: LeaveConflict): string {
  const ref = Array.isArray(conflict.technician_reference)
    ? conflict.technician_reference[0]
    : conflict.technician_reference;
  return ref?.display_name ?? "A technician";
}

export type DayVersion = {
  id: string;
  schedule_date: string;
  status: string;
  version_number: number;
};

// The current version of a day, creating a first draft for today or a future
// date that was never opened (the same rule as loading the day on the board:
// a past date is never auto-created). Returns null for a past date with no
// version.
export async function findOrCreateDraftVersion(
  admin: Admin,
  date: string,
  profileId: string,
  timeZone: string,
): Promise<{ version: DayVersion; created: boolean } | null> {
  const select = "id, schedule_date, status, version_number";
  const { data: current, error } = await admin
    .from("schedule_versions")
    .select(select)
    .eq("schedule_date", date)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (current) return { version: current as DayVersion, created: false };

  if (date < todayInZone(timeZone)) return null;

  const { data: created, error: createError } = await admin
    .from("schedule_versions")
    .insert({ schedule_date: date, version_number: 1, status: "draft", created_by: profileId })
    .select(select)
    .single();
  if (createError) {
    // Someone opened the day at the same moment: take theirs.
    if (createError.code === "23505") {
      const { data: again } = await admin
        .from("schedule_versions")
        .select(select)
        .eq("schedule_date", date)
        .eq("is_current", true)
        .maybeSingle();
      if (again) return { version: again as DayVersion, created: false };
    }
    throw new Error(createError.message);
  }

  await admin.from("schedule_audit_events").insert({
    event_type: "draft_created",
    actor_id: profileId,
    origin: "portal",
    schedule_date: date,
    schedule_version_id: created.id,
  });
  return { version: created as DayVersion, created: true };
}

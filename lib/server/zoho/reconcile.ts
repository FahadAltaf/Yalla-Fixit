// Delta reconciliation for direct Zoho FSM changes (SYNC-014).
//
// Ported from the zoho-fsm-reconcile Edge Function, with two changes:
//
//  1. It can be scoped to a single operating date. The old every-10-minutes
//     pg_cron job re-read EVERY current entry across every day, mostly to
//     find nothing. Reconciling just the day a scheduler is looking at, at
//     the moment they look at it, is both far cheaper and fresher.
//  2. FSM reads run in bounded-concurrency batches rather than strictly
//     one-at-a-time, so a busy day still finishes inside a serverless
//     function's time limit.
//
// FSM is authoritative, so a real difference is simply ADOPTED into the
// portal entry (start/end times). No "changed in FSM" review flag is raised
// -- per YFI, a Refresh should keep the schedule in step with FSM rather
// than warn about it.

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  fsmGetRecord,
  fsmOk,
  fsmResultFromError,
  getFsmAccessToken,
  type FsmResult,
} from "./fsm-client";

// How many appointments to re-read from FSM at once. High enough that a full
// day finishes quickly, low enough to stay polite to Zoho's rate limits.
const FSM_READ_CONCURRENCY = 8;

type AppointmentDetail = {
  id: string;
  Modified_Time?: string;
  Status?: string;
  Cancellation_Reason?: string | null;
  Scheduled_Start_Date_Time?: string | null;
  Scheduled_End_Date_Time?: string | null;
};

type ScheduleEntryRow = {
  id: string;
  schedule_version_id: string;
  fsm_appointment_id: string;
  fsm_last_modified_marker: string | null;
  start_at: string;
  end_at: string;
};

// Two ISO timestamps are "the same" if they land on the same instant. FSM and
// the portal may format the zone differently, so compare epoch millis.
function sameInstant(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ReconcileOptions = {
  // Restrict to one operating date (YYYY-MM-DD). Omit to sweep every current
  // version, which is what the manual "Refresh everything" action does.
  operatingDate?: string;
};

export async function reconcileFsmAppointments(
  options: ReconcileOptions = {},
): Promise<FsmResult> {
  try {
    const admin = await createAdminServerClient();
    const token = await getFsmAccessToken(admin);

    // Only entries on the CURRENT version of each daily schedule are live
    // commitments worth reconciling; historical versions are immutable.
    let query = admin
      .from("schedule_entries")
      .select(
        "id, schedule_version_id, fsm_appointment_id, fsm_last_modified_marker, start_at, end_at, schedule_versions!inner(id, is_current)",
      )
      .not("fsm_appointment_id", "is", null)
      .eq("schedule_versions.is_current", true);

    if (options.operatingDate) query = query.eq("operating_date", options.operatingDate);

    const { data: entries, error: entriesError } = await query;
    if (entriesError) throw new Error(entriesError.message);

    const rows = (entries ?? []) as unknown as ScheduleEntryRow[];
    let checked = 0;
    let changed = 0;

    for (const batch of chunk(rows, FSM_READ_CONCURRENCY)) {
      const results = await Promise.all(
        batch.map(async (entry) => {
          const res = await fsmGetRecord<AppointmentDetail>(
            token,
            "Service_Appointments",
            entry.fsm_appointment_id,
          );
          if (!res.ok) {
            console.error(
              `[zoho:reconcile] fetch failed for ${entry.fsm_appointment_id}:`,
              res.json,
            );
            return null;
          }
          return res.record ? { entry, current: res.record } : null;
        }),
      );

      for (const result of results) {
        if (!result) continue;
        const { entry, current } = result;
        checked += 1;

        const markerChanged =
          !entry.fsm_last_modified_marker || current.Modified_Time !== entry.fsm_last_modified_marker;
        const isCancelled = Boolean(current.Cancellation_Reason);

        // A bumped Modified_Time alone is NOT a real change: Zoho runs a
        // function on every appointment create/update that touches the
        // record, so a freshly-created portal appointment always looks
        // "modified". Only treat it as a change if a field the portal cares
        // about actually differs -- the scheduled window, or a cancellation.
        const timesDiffer =
          !sameInstant(current.Scheduled_Start_Date_Time, entry.start_at) ||
          !sameInstant(current.Scheduled_End_Date_Time, entry.end_at);
        const materiallyChanged = isCancelled || timesDiffer;

        // Keep the marker in step even on a non-material bump so we don't
        // re-evaluate the same automation change every cycle.
        if (!materiallyChanged) {
          if (markerChanged && current.Modified_Time) {
            await admin
              .from("schedule_entries")
              .update({ fsm_last_modified_marker: current.Modified_Time })
              .eq("id", entry.id);
          }
          continue;
        }

        changed += 1;

        // FSM is authoritative: adopt its scheduled window straight into the
        // portal entry so the board reflects FSM after a Refresh.
        const syncUpdate: Record<string, unknown> = {
          fsm_last_modified_marker: current.Modified_Time ?? entry.fsm_last_modified_marker,
          updated_at: new Date().toISOString(),
        };
        if (current.Scheduled_Start_Date_Time) syncUpdate.start_at = current.Scheduled_Start_Date_Time;
        if (current.Scheduled_End_Date_Time) syncUpdate.end_at = current.Scheduled_End_Date_Time;
        await admin.from("schedule_entries").update(syncUpdate).eq("id", entry.id);

        // Keep a lightweight, non-alarming trail in the audit log.
        await admin.from("schedule_audit_events").insert({
          event_type: isCancelled ? "fsm_appointment_cancelled" : "fsm_change_synced",
          origin: "fsm",
          schedule_version_id: entry.schedule_version_id,
          affected_entity_type: "schedule_entry",
          affected_entity_id: entry.id,
          after_value: current,
        });
      }
    }

    return fsmOk({ checked, changed, scope: options.operatingDate ?? "all-current" });
  } catch (error) {
    return fsmResultFromError(error, "zoho:reconcileFsmAppointments");
  }
}

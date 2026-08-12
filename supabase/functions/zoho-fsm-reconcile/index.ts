// Supabase Edge Function: zoho-fsm-reconcile
//
// Periodic delta reconciliation for direct FSM changes (SYNC-014). Chosen
// over webhooks per stakeholder decision: this Edge Function is invoked on
// a schedule (pg_cron, see the accompanying migration) rather than
// receiving inbound Zoho events.
//
// For every FSM-backed schedule entry belonging to the CURRENT version of
// any daily schedule, re-reads the appointment from FSM and compares its
// scheduled window against what the portal holds. FSM is authoritative, so a
// real difference is simply ADOPTED into the portal entry (start/end times)
// and the snapshot marker advanced. No "changed in FSM" review flag is raised
// -- per YFI, a Refresh should just keep the schedule in step with FSM rather
// than warning about it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FSM_BASE_URL = "https://fsm.zoho.com/fsm/v1";

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
  schedule_versions: {
    id: string;
    daily_schedule_id: string;
    status: string;
  };
};

// Two ISO timestamps are "the same" if they land on the same instant. FSM and
// the portal may format the zone differently, so compare epoch millis.
function sameInstant(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment is not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("oauth_access_token")
      .eq("id", 1)
      .single();
    if (settingsError || !settings?.oauth_access_token) {
      return jsonResponse({ error: "Zoho FSM OAuth token is not configured" }, 500);
    }
    const accessToken = settings.oauth_access_token as string;
    const authHeaders = { Authorization: `Zoho-oauthtoken ${accessToken}` };

    // Only entries on the CURRENT version of each daily schedule are live
    // commitments worth reconciling; historical versions are immutable.
    const { data: entries, error: entriesError } = await supabase
      .from("schedule_entries")
      .select("id, schedule_version_id, fsm_appointment_id, fsm_last_modified_marker, start_at, end_at, schedule_versions!inner(id, daily_schedule_id, status, is_current)")
      .not("fsm_appointment_id", "is", null)
      .eq("schedule_versions.is_current", true);
    if (entriesError) throw new Error(entriesError.message);

    const rows = (entries ?? []) as unknown as ScheduleEntryRow[];
    let checked = 0;
    let changed = 0;

    for (const entry of rows) {
      checked += 1;
      const res = await fetch(`${FSM_BASE_URL}/Service_Appointments/${entry.fsm_appointment_id}`, {
        headers: authHeaders,
      });
      if (!res.ok) {
        console.error(`[zoho-fsm-reconcile] fetch failed for ${entry.fsm_appointment_id}:`, await res.text());
        continue;
      }
      const payload = await res.json();
      const current: AppointmentDetail | undefined = payload?.data?.[0];
      if (!current) continue;

      const markerChanged =
        !entry.fsm_last_modified_marker || current.Modified_Time !== entry.fsm_last_modified_marker;
      const isCancelled = Boolean(current.Cancellation_Reason);

      // A bumped Modified_Time alone is NOT a real change: Zoho runs a
      // function on every appointment create/update that touches the record,
      // so a freshly-created portal appointment always looks "modified". Only
      // treat it as a change if a field the portal cares about actually
      // differs -- the scheduled window, or a cancellation (YFI feedback: the
      // portal was flagging its own creations as "changed in FSM").
      const timesDiffer =
        !sameInstant(current.Scheduled_Start_Date_Time, entry.start_at) ||
        !sameInstant(current.Scheduled_End_Date_Time, entry.end_at);
      const materiallyChanged = isCancelled || timesDiffer;

      // Always refresh the snapshot cache, even when unchanged, so
      // last_checked_at reflects reconciliation health.
      await supabase.from("fsm_appointment_snapshots").upsert(
        {
          fsm_appointment_id: entry.fsm_appointment_id,
          last_modified_marker: current.Modified_Time ?? null,
          last_known_status: current.Status ?? null,
          captured_fields: current,
          last_checked_at: new Date().toISOString(),
          last_changed_detected_at: materiallyChanged ? new Date().toISOString() : undefined,
        },
        { onConflict: "fsm_appointment_id" },
      );

      // Keep the marker in step even on a non-material bump so we don't
      // re-evaluate the same automation change every cycle.
      if (!materiallyChanged) {
        if (markerChanged && current.Modified_Time) {
          await supabase
            .from("schedule_entries")
            .update({ fsm_last_modified_marker: current.Modified_Time })
            .eq("id", entry.id);
        }
        continue;
      }

      changed += 1;

      // FSM is authoritative: adopt its scheduled window straight into the
      // portal entry so the board reflects FSM after a Refresh. No review
      // flag, no version/day "FSM changed" marker -- just stay in sync.
      const syncUpdate: Record<string, unknown> = {
        fsm_last_modified_marker: current.Modified_Time ?? entry.fsm_last_modified_marker,
        updated_at: new Date().toISOString(),
      };
      if (current.Scheduled_Start_Date_Time) syncUpdate.start_at = current.Scheduled_Start_Date_Time;
      if (current.Scheduled_End_Date_Time) syncUpdate.end_at = current.Scheduled_End_Date_Time;
      await supabase.from("schedule_entries").update(syncUpdate).eq("id", entry.id);

      // Keep a lightweight, non-alarming trail in the audit log.
      await supabase.from("schedule_audit_events").insert({
        event_type: isCancelled ? "fsm_appointment_cancelled" : "fsm_change_synced",
        origin: "fsm",
        schedule_version_id: entry.schedule_version_id,
        affected_entity_type: "schedule_entry",
        affected_entity_id: entry.id,
        after_value: current,
      });
    }

    return jsonResponse({ checked, changed }, 200);
  } catch (error: unknown) {
    console.error("[zoho-fsm-reconcile]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, 500);
  }
});

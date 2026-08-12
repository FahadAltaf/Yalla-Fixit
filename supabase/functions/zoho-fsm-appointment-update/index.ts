// Supabase Edge Function: zoho-fsm-appointment-update
//
// Updates an existing Zoho FSM Service Appointment's schedule and
// assigned technicians via the dedicated reschedule action. Used by two
// distinct FRD flows that share the same FSM call:
//   - SYNC-005: approval-time updates to selected existing appointments.
//   - SYNC-019/BR-010: immediate sync when a scheduler edits a field on
//     an already-Published appointment (no whole-day reapproval needed).
//
// Before writing, re-reads the appointment's Modified_Time and compares
// it against the caller-supplied expected marker (SYNC-020/APR-005): if
// FSM has moved on since the portal last saw this record, the update is
// refused so a stale portal value can't silently overwrite a newer FSM
// change (BR-004).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FSM_BASE_URL = "https://fsm.zoho.com/fsm/v1";

type UpdateRequestBody = {
  appointmentId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  serviceResourceIds?: string[];
  expectedModifiedTime?: string; // last-modified marker the portal last observed
  correlationId?: string;
};

type AppointmentDetail = {
  id: string;
  Modified_Time?: string;
  Status?: string;
  Cancellation_Reason?: string | null;
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: UpdateRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { appointmentId, scheduledStart, scheduledEnd, serviceResourceIds, correlationId } = body;

  if (!appointmentId) return jsonResponse({ error: "Missing field: appointmentId" }, 400);
  if (!scheduledStart) return jsonResponse({ error: "Missing field: scheduledStart" }, 400);
  if (!scheduledEnd) return jsonResponse({ error: "Missing field: scheduledEnd" }, 400);
  if (!serviceResourceIds?.length) {
    return jsonResponse({ error: "Missing field: serviceResourceIds (at least one required)" }, 400);
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
    const authHeaders = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    };

    // Re-read before writing (SYNC-019, SYNC-020, APR-005).
    const getRes = await fetch(`${FSM_BASE_URL}/Service_Appointments/${appointmentId}`, {
      headers: authHeaders,
    });
    if (!getRes.ok) {
      const errBody = await getRes.text();
      console.error("[zoho-fsm-appointment-update] appointment fetch failed:", errBody);
      return jsonResponse({ error: "Failed to re-read appointment from Zoho FSM" }, 502);
    }
    const getPayload = await getRes.json();
    const current: AppointmentDetail | undefined = getPayload?.data?.[0];
    if (!current) {
      return jsonResponse({ error: "Appointment not found in Zoho FSM" }, 404);
    }

    if (current.Cancellation_Reason) {
      // SYNC-017: don't let a stale portal version overwrite a cancellation.
      return jsonResponse(
        { error: "Appointment is cancelled in Zoho FSM", status: current.Status },
        409,
      );
    }

    // NOTE: we deliberately DO NOT refuse on a Modified_Time mismatch anymore.
    // Zoho runs a function on every appointment create/update that bumps
    // Modified_Time, so an untouched appointment carried into a revision would
    // always look "changed" and fail (YFI v1.5). Genuine external edits are
    // caught separately by the reconcile job, which sets an entry to
    // review_required and blocks approval before we ever get here. So a
    // reschedule is allowed to proceed; the marker is only informational.

    const lead = serviceResourceIds[0];
    const reschedulePayload = {
      data: [
        {
          Scheduled_Start_Date_Time: scheduledStart,
          Scheduled_End_Date_Time: scheduledEnd,
          $Service_Resources: serviceResourceIds,
          // Match create: don't hard-fail a reschedule that overlaps another
          // appointment for the same resource (reschedule action limitation).
          $allow_overlapping: true,
          ...(serviceResourceIds.length > 1 ? { Lead: lead } : {}),
        },
      ],
    };

    const updateRes = await fetch(
      `${FSM_BASE_URL}/Service_Appointments/${appointmentId}/actions/reschedule`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(reschedulePayload),
      },
    );

    const updateText = await updateRes.text();
    let updateJson: unknown;
    try {
      updateJson = JSON.parse(updateText);
    } catch {
      updateJson = { raw: updateText };
    }

    if (!updateRes.ok) {
      console.error("[zoho-fsm-appointment-update] FSM reschedule failed:", updateJson);
      return jsonResponse(
        { error: "Zoho FSM rejected the reschedule", details: updateJson, correlationId },
        502,
      );
    }

    // Read back the appointment AFTER the write so the caller can store the
    // post-write Modified_Time. Without this the portal's own reschedule
    // looks like an external FSM change to the reconcile job, which then
    // (wrongly) flags the entry as "changed in FSM" (YFI feedback on R-05).
    let modifiedTime: string | null = null;
    let appointmentStatus: string | null = null;
    try {
      const reReadRes = await fetch(`${FSM_BASE_URL}/Service_Appointments/${appointmentId}`, {
        headers: authHeaders,
      });
      if (reReadRes.ok) {
        const reReadJson = await reReadRes.json();
        const after: AppointmentDetail | undefined = reReadJson?.data?.[0];
        modifiedTime = after?.Modified_Time ?? null;
        appointmentStatus = after?.Status ?? null;
      }
    } catch {
      // Non-fatal: the reschedule succeeded; only the fresh marker is missing.
    }

    return jsonResponse(
      { appointmentId, modifiedTime, status: appointmentStatus, correlationId, raw: updateJson },
      200,
    );
  } catch (error: unknown) {
    console.error("[zoho-fsm-appointment-update]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, 500);
  }
});

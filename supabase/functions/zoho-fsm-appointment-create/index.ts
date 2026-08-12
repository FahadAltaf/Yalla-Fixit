// Supabase Edge Function: zoho-fsm-appointment-create
//
// Creates a Zoho FSM Service Appointment, already scheduled and assigned,
// for a work order that currently has none (FRD BR-008/BR-009, SYNC-003,
// SYNC-005, PLAN-007, UC-03, Section 12.2). Only called from the whole-day
// approval flow, never during drafting.
//
// Zoho FSM requires $Service_Line_Items on create: the ids of the work
// order's Appointments_X_Services entries that don't yet have a
// Service_Appointment attached. This function re-reads the work order
// immediately before creating (SYNC-004) so a stale draft can't silently
// duplicate an appointment that was created elsewhere in the meantime.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FSM_BASE_URL = "https://fsm.zoho.com/fsm/v1";

type CreateRequestBody = {
  workOrderId?: string;
  scheduledStart?: string; // ISO 8601, e.g. 2026-07-21T09:00:00+04:00
  scheduledEnd?: string;
  serviceResourceIds?: string[]; // FSM Service_Resources.id values
  summary?: string;
  territoryId?: string; // required only if the org has multiple territories
  correlationId?: string; // caller-supplied idempotency/audit key, echoed back
  // The Service_Line_Item ids ($Service_Line_Items) this appointment covers.
  // The team chooses these; if omitted we derive every unscheduled line.
  serviceLineItemIds?: string[];
  serviceTaskLineItemIds?: string[];
  appointmentType?: string; // FSM Type picklist value
  scheduleType?: "Time-bound" | "All Day";
  appointmentDate?: string; // YYYY-MM-DD, used when scheduleType is "All Day"
};

type ServiceLineItem = {
  id: string;
};

type AxsItem = {
  Service_Line_Item?: { id: string } | null;
  Service_Appointment?: { id: string; name: string } | null;
};

type WorkOrderDetail = {
  id: string;
  Name?: string;
  Type?: string;
  Service_Line_Items?: ServiceLineItem[];
  Service_Tasks_Line_Items?: { id: string }[];
  Appointments_X_Services?: AxsItem[];
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

  let body: CreateRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { workOrderId, scheduledStart, scheduledEnd, serviceResourceIds, correlationId } = body;
  const scheduleType = body.scheduleType ?? "Time-bound";

  if (!workOrderId) return jsonResponse({ error: "Missing field: workOrderId" }, 400);
  if (scheduleType === "Time-bound") {
    if (!scheduledStart) return jsonResponse({ error: "Missing field: scheduledStart" }, 400);
    if (!scheduledEnd) return jsonResponse({ error: "Missing field: scheduledEnd" }, 400);
  } else if (!body.appointmentDate) {
    return jsonResponse({ error: "Missing field: appointmentDate (required for All Day)" }, 400);
  }
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

    // SYNC-004: re-read the work order right before creating so a stale
    // draft can't duplicate an appointment created elsewhere meanwhile.
    const woRes = await fetch(`${FSM_BASE_URL}/Work_Orders/${workOrderId}`, {
      headers: authHeaders,
    });
    if (!woRes.ok) {
      const errBody = await woRes.text();
      console.error("[zoho-fsm-appointment-create] work order fetch failed:", errBody);
      return jsonResponse({ error: "Failed to re-read work order from Zoho FSM" }, 502);
    }
    const woPayload = await woRes.json();
    const wo: WorkOrderDetail | undefined = woPayload?.data?.[0];
    if (!wo) {
      return jsonResponse({ error: "Work order not found in Zoho FSM" }, 404);
    }

    // Which service lines are still unscheduled (not already on an appointment).
    const scheduledLineIds = new Set<string>();
    for (const axs of wo.Appointments_X_Services ?? []) {
      if (axs.Service_Line_Item?.id && axs.Service_Appointment?.id) {
        scheduledLineIds.add(axs.Service_Line_Item.id);
      }
    }
    const unscheduledLineIds = (wo.Service_Line_Items ?? [])
      .map((l) => l.id)
      .filter((id) => !scheduledLineIds.has(id));

    // $Service_Line_Items expects the Service_Line_Item ids (SVC-xxxx). The
    // team's chosen ids win; if none were passed, fall back to every
    // unscheduled line. (The old code sent Appointments_X_Services join ids
    // here, which FSM rejects -- the cause of the failed sync.)
    let serviceLineItemIds =
      body.serviceLineItemIds && body.serviceLineItemIds.length > 0
        ? body.serviceLineItemIds.filter((id) => !scheduledLineIds.has(id))
        : unscheduledLineIds;

    if (serviceLineItemIds.length === 0) {
      // Either every line is already scheduled, or all chosen lines were.
      return jsonResponse(
        {
          error:
            "The selected service line(s) already have an appointment in FSM, or the work order has no unscheduled lines.",
          workOrderId,
          alreadyScheduled: [...scheduledLineIds],
        },
        409,
      );
    }

    // $Service_Tasks_Line_Items is only required when the work order actually
    // has service tasks; include the chosen ones, or all of them.
    const allTaskIds = (wo.Service_Tasks_Line_Items ?? []).map((t) => t.id);
    const serviceTaskLineItemIds =
      body.serviceTaskLineItemIds && body.serviceTaskLineItemIds.length > 0
        ? body.serviceTaskLineItemIds
        : allTaskIds;

    const lead = serviceResourceIds[0];
    const appointmentRecord: Record<string, unknown> = {
      Summary: body.summary ?? wo.Name ?? `Work Order ${workOrderId}`,
      Schedule_Type: scheduleType,
      $Service_Line_Items: serviceLineItemIds,
      $Service_Resources: serviceResourceIds,
      // FSM rejects a create that overlaps another appointment for the same
      // resource unless this is set (and the org allows/warns on overlap).
      // The portal doesn't police same-day overlaps, so allow it rather than
      // hard-fail a legitimate schedule.
      $allow_overlapping: true,
      ...(serviceTaskLineItemIds.length > 0 ? { $Service_Tasks_Line_Items: serviceTaskLineItemIds } : {}),
      ...(serviceResourceIds.length > 1 ? { Lead: lead } : {}),
      ...(body.territoryId ? { Territory: body.territoryId } : {}),
      // Type is a picklist; "-None-" means the caller left it unset.
      ...(body.appointmentType && body.appointmentType !== "-None-"
        ? { Type: body.appointmentType }
        : {}),
    };
    if (scheduleType === "All Day") {
      // FSM requires Appointment_Date, Scheduled_Duration and Due_Date for an
      // All-Day appointment (it has no start/end). Duration is in seconds;
      // derive it from the shift-bound window the entry carries, defaulting to
      // a standard 8h day if that isn't usable.
      let durationSeconds = 8 * 3600;
      if (scheduledStart && scheduledEnd) {
        const diff = Math.round((new Date(scheduledEnd).getTime() - new Date(scheduledStart).getTime()) / 1000);
        if (diff > 0) durationSeconds = diff;
      }
      appointmentRecord.Appointment_Date = body.appointmentDate;
      appointmentRecord.Due_Date = body.appointmentDate;
      appointmentRecord.Scheduled_Duration = durationSeconds;
    } else {
      appointmentRecord.Scheduled_Start_Date_Time = scheduledStart;
      appointmentRecord.Scheduled_End_Date_Time = scheduledEnd;
    }

    const createPayload = { data: [appointmentRecord] };

    const createRes = await fetch(`${FSM_BASE_URL}/Service_Appointments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(createPayload),
    });

    const createText = await createRes.text();
    let createJson: unknown;
    try {
      createJson = JSON.parse(createText);
    } catch {
      createJson = { raw: createText };
    }

    if (!createRes.ok) {
      console.error("[zoho-fsm-appointment-create] FSM create failed:", createJson);
      return jsonResponse(
        { error: "Zoho FSM rejected the appointment creation", details: createJson, correlationId },
        502,
      );
    }

    const created = (createJson as { data?: Array<{ id?: string; Name?: string }> })?.data?.[0];

    // The create response does not reliably carry the human-readable name
    // (AP1043) or the Modified_Time, so read the record back once. The name
    // is shown on the grid; the Modified_Time is stored as the sync marker so
    // the reconcile job doesn't mistake this creation for an external change.
    let appointmentName = created?.Name ?? null;
    let modifiedTime: string | null = null;
    if (created?.id) {
      try {
        const readRes = await fetch(`${FSM_BASE_URL}/Service_Appointments/${created.id}`, {
          headers: authHeaders,
        });
        if (readRes.ok) {
          const readJson = await readRes.json();
          appointmentName = appointmentName ?? readJson?.data?.[0]?.Name ?? null;
          modifiedTime = readJson?.data?.[0]?.Modified_Time ?? null;
        }
      } catch {
        // Non-fatal: the appointment exists; only its label/marker is missing.
      }
    }

    return jsonResponse(
      {
        appointmentId: created?.id ?? null,
        appointmentName,
        modifiedTime,
        serviceLineItemIds,
        workOrderId,
        correlationId,
        raw: createJson,
      },
      200,
    );
  } catch (error: unknown) {
    console.error("[zoho-fsm-appointment-create]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, 500);
  }
});

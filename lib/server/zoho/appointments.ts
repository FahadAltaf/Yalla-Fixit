// Zoho FSM Service Appointment writes.
//
// Ported from the zoho-fsm-appointment-create / zoho-fsm-appointment-update
// Edge Functions (FRD BR-008/BR-009, SYNC-003/005, PLAN-007, UC-03,
// Section 12.2). Only reached from the whole-day approval flow, the retry
// action, and the published-edit path -- never during drafting.

import {
  fsmFail,
  fsmFetch,
  fsmGetRecord,
  fsmOk,
  fsmResultFromError,
  getFsmContext,
  type FsmResult,
} from "./fsm-client";

export type CreateAppointmentInput = {
  workOrderId: string;
  scheduledStart?: string | null; // ISO 8601, e.g. 2026-07-21T09:00:00+04:00
  scheduledEnd?: string | null;
  serviceResourceIds: string[]; // FSM Service_Resources.id values
  summary?: string | null;
  territoryId?: string; // required only if the org has multiple territories
  correlationId?: string; // caller-supplied idempotency/audit key, echoed back
  // The Service_Line_Item ids ($Service_Line_Items) this appointment covers.
  // The team chooses these; if omitted we derive every unscheduled line.
  serviceLineItemIds?: string[];
  serviceTaskLineItemIds?: string[];
  appointmentType?: string | null; // FSM Type picklist value
  scheduleType?: "Time-bound" | "All Day";
  appointmentDate?: string; // YYYY-MM-DD, used when scheduleType is "All Day"
};

export type UpdateAppointmentInput = {
  appointmentId: string;
  scheduledStart: string;
  scheduledEnd: string;
  serviceResourceIds: string[];
  expectedModifiedTime?: string | null; // last marker the portal observed
  correlationId?: string;
};

type ServiceLineItem = { id: string };

type AxsItem = {
  Service_Line_Item?: { id: string } | null;
  Service_Appointment?: { id: string; name?: string } | null;
};

type WorkOrderDetail = {
  id: string;
  Name?: string;
  Type?: string;
  Service_Line_Items?: ServiceLineItem[];
  Service_Tasks_Line_Items?: { id: string }[];
  Appointments_X_Services?: AxsItem[];
};

type AppointmentDetail = {
  id: string;
  Name?: string;
  Modified_Time?: string;
  Status?: string;
  Cancellation_Reason?: string | null;
  Scheduled_Start_Date_Time?: string | null;
  Scheduled_End_Date_Time?: string | null;
};

const DEFAULT_ALL_DAY_SECONDS = 8 * 3600;

// The Service_Line_Item ids already sitting on an appointment, so a line is
// never double-scheduled.
export function scheduledLineIdsOf(wo: WorkOrderDetail): Set<string> {
  const ids = new Set<string>();
  for (const axs of wo.Appointments_X_Services ?? []) {
    if (axs.Service_Line_Item?.id && axs.Service_Appointment?.id) {
      ids.add(axs.Service_Line_Item.id);
    }
  }
  return ids;
}

// Creates a scheduled, assigned Service Appointment for a work order that
// has none yet.
//
// SYNC-004: the work order is re-read immediately before the write so a
// stale draft can't silently duplicate an appointment created elsewhere in
// the meantime.
export async function createFsmAppointment(input: CreateAppointmentInput): Promise<FsmResult> {
  const scheduleType = input.scheduleType ?? "Time-bound";

  if (!input.workOrderId) return fsmFail("Missing field: workOrderId", 400);
  if (scheduleType === "Time-bound") {
    if (!input.scheduledStart) return fsmFail("Missing field: scheduledStart", 400);
    if (!input.scheduledEnd) return fsmFail("Missing field: scheduledEnd", 400);
  } else if (!input.appointmentDate) {
    return fsmFail("Missing field: appointmentDate (required for All Day)", 400);
  }
  if (!input.serviceResourceIds?.length) {
    return fsmFail("Missing field: serviceResourceIds (at least one required)", 400);
  }

  try {
    const { token } = await getFsmContext();

    const woRes = await fsmGetRecord<WorkOrderDetail>(token, "Work_Orders", input.workOrderId);
    if (!woRes.ok) {
      console.error("[zoho:createFsmAppointment] work order fetch failed:", woRes.json);
      return fsmFail("Failed to re-read work order from Zoho FSM", 502);
    }
    const wo = woRes.record;
    if (!wo) return fsmFail("Work order not found in Zoho FSM", 404);

    const scheduledLineIds = scheduledLineIdsOf(wo);
    const unscheduledLineIds = (wo.Service_Line_Items ?? [])
      .map((l) => l.id)
      .filter((id) => !scheduledLineIds.has(id));

    // $Service_Line_Items expects the Service_Line_Item ids (SVC-xxxx). The
    // team's chosen ids win; if none were passed, fall back to every
    // unscheduled line.
    const serviceLineItemIds =
      input.serviceLineItemIds && input.serviceLineItemIds.length > 0
        ? input.serviceLineItemIds.filter((id) => !scheduledLineIds.has(id))
        : unscheduledLineIds;

    if (serviceLineItemIds.length === 0) {
      // Either every line is already scheduled, or all chosen lines were.
      return fsmFail(
        "The selected service line(s) already have an appointment in FSM, or the work order has no unscheduled lines.",
        409,
        { workOrderId: input.workOrderId, alreadyScheduled: [...scheduledLineIds] },
      );
    }

    // $Service_Tasks_Line_Items is only required when the work order actually
    // has service tasks; include the chosen ones, or all of them.
    const allTaskIds = (wo.Service_Tasks_Line_Items ?? []).map((t) => t.id);
    const serviceTaskLineItemIds =
      input.serviceTaskLineItemIds && input.serviceTaskLineItemIds.length > 0
        ? input.serviceTaskLineItemIds
        : allTaskIds;

    const lead = input.serviceResourceIds[0];
    const appointmentRecord: Record<string, unknown> = {
      Summary: input.summary ?? wo.Name ?? `Work Order ${input.workOrderId}`,
      Schedule_Type: scheduleType,
      $Service_Line_Items: serviceLineItemIds,
      $Service_Resources: input.serviceResourceIds,
      // FSM rejects a create that overlaps another appointment for the same
      // resource unless this is set. The portal doesn't police same-day
      // overlaps, so allow it rather than hard-fail a legitimate schedule.
      $allow_overlapping: true,
      ...(serviceTaskLineItemIds.length > 0
        ? { $Service_Tasks_Line_Items: serviceTaskLineItemIds }
        : {}),
      ...(input.serviceResourceIds.length > 1 ? { Lead: lead } : {}),
      ...(input.territoryId ? { Territory: input.territoryId } : {}),
      // Type is a picklist; "-None-" means the caller left it unset.
      ...(input.appointmentType && input.appointmentType !== "-None-"
        ? { Type: input.appointmentType }
        : {}),
    };

    if (scheduleType === "All Day") {
      // FSM requires Appointment_Date, Scheduled_Duration and Due_Date for an
      // All-Day appointment (it has no start/end). Duration is in seconds;
      // derive it from the shift-bound window the entry carries, defaulting to
      // a standard 8h day if that isn't usable.
      let durationSeconds = DEFAULT_ALL_DAY_SECONDS;
      if (input.scheduledStart && input.scheduledEnd) {
        const diff = Math.round(
          (new Date(input.scheduledEnd).getTime() - new Date(input.scheduledStart).getTime()) / 1000,
        );
        if (diff > 0) durationSeconds = diff;
      }
      appointmentRecord.Appointment_Date = input.appointmentDate;
      appointmentRecord.Due_Date = input.appointmentDate;
      appointmentRecord.Scheduled_Duration = durationSeconds;
    } else {
      appointmentRecord.Scheduled_Start_Date_Time = input.scheduledStart;
      appointmentRecord.Scheduled_End_Date_Time = input.scheduledEnd;
    }

    const createRes = await fsmFetch(token, "/Service_Appointments", {
      method: "POST",
      body: JSON.stringify({ data: [appointmentRecord] }),
    });

    if (!createRes.ok) {
      console.error("[zoho:createFsmAppointment] FSM create failed:", createRes.json);
      return fsmFail("Zoho FSM rejected the appointment creation", 502, {
        details: createRes.json,
        correlationId: input.correlationId,
      });
    }

    const created = createRes.json?.data?.[0] as { id?: string; Name?: string } | undefined;

    // The create response does not reliably carry the human-readable name
    // (AP1043) or the Modified_Time, so read the record back once. The name
    // is shown on the grid; the Modified_Time is stored as the sync marker so
    // the reconcile job doesn't mistake this creation for an external change.
    let appointmentName = created?.Name ?? null;
    let modifiedTime: string | null = null;
    if (created?.id) {
      try {
        const readBack = await fsmGetRecord<AppointmentDetail>(
          token,
          "Service_Appointments",
          created.id,
        );
        if (readBack.ok) {
          appointmentName = appointmentName ?? readBack.record?.Name ?? null;
          modifiedTime = readBack.record?.Modified_Time ?? null;
        }
      } catch {
        // Non-fatal: the appointment exists; only its label/marker is missing.
      }
    }

    return fsmOk({
      appointmentId: created?.id ?? null,
      appointmentName,
      modifiedTime,
      serviceLineItemIds,
      workOrderId: input.workOrderId,
      correlationId: input.correlationId,
      raw: createRes.json,
    });
  } catch (error) {
    return fsmResultFromError(error, "zoho:createFsmAppointment");
  }
}

// Updates an existing appointment's schedule and assigned technicians via
// FSM's dedicated reschedule action. Shared by SYNC-005 (approval-time
// updates) and SYNC-019/BR-010 (immediate sync of an edit to an already
// published appointment).
export async function updateFsmAppointment(input: UpdateAppointmentInput): Promise<FsmResult> {
  if (!input.appointmentId) return fsmFail("Missing field: appointmentId", 400);
  if (!input.scheduledStart) return fsmFail("Missing field: scheduledStart", 400);
  if (!input.scheduledEnd) return fsmFail("Missing field: scheduledEnd", 400);
  if (!input.serviceResourceIds?.length) {
    return fsmFail("Missing field: serviceResourceIds (at least one required)", 400);
  }

  try {
    const { token } = await getFsmContext();

    // Re-read before writing (SYNC-019, SYNC-020, APR-005).
    const getRes = await fsmGetRecord<AppointmentDetail>(
      token,
      "Service_Appointments",
      input.appointmentId,
    );
    if (!getRes.ok) {
      console.error("[zoho:updateFsmAppointment] appointment fetch failed:", getRes.json);
      return fsmFail("Failed to re-read appointment from Zoho FSM", 502);
    }
    const current = getRes.record;
    if (!current) return fsmFail("Appointment not found in Zoho FSM", 404);

    if (current.Cancellation_Reason) {
      // SYNC-017: don't let a stale portal version overwrite a cancellation.
      return fsmFail("Appointment is cancelled in Zoho FSM", 409, { status: current.Status });
    }

    // NOTE: we deliberately DO NOT refuse on a Modified_Time mismatch. Zoho
    // runs a function on every appointment create/update that bumps
    // Modified_Time, so an untouched appointment carried into a revision would
    // always look "changed" and fail (YFI v1.5). Genuine external edits are
    // caught separately by reconcile. The marker is only informational here.

    const lead = input.serviceResourceIds[0];
    const updateRes = await fsmFetch(
      token,
      `/Service_Appointments/${encodeURIComponent(input.appointmentId)}/actions/reschedule`,
      {
        method: "PUT",
        body: JSON.stringify({
          data: [
            {
              Scheduled_Start_Date_Time: input.scheduledStart,
              Scheduled_End_Date_Time: input.scheduledEnd,
              $Service_Resources: input.serviceResourceIds,
              // Match create: don't hard-fail a reschedule that overlaps
              // another appointment for the same resource.
              $allow_overlapping: true,
              ...(input.serviceResourceIds.length > 1 ? { Lead: lead } : {}),
            },
          ],
        }),
      },
    );

    if (!updateRes.ok) {
      console.error("[zoho:updateFsmAppointment] FSM reschedule failed:", updateRes.json);
      return fsmFail("Zoho FSM rejected the reschedule", 502, {
        details: updateRes.json,
        correlationId: input.correlationId,
      });
    }

    // Read back AFTER the write so the caller can store the post-write
    // Modified_Time. Without this the portal's own reschedule looks like an
    // external FSM change to the reconcile job (YFI feedback on R-05).
    let modifiedTime: string | null = null;
    let appointmentStatus: string | null = null;
    try {
      const reRead = await fsmGetRecord<AppointmentDetail>(
        token,
        "Service_Appointments",
        input.appointmentId,
      );
      if (reRead.ok) {
        modifiedTime = reRead.record?.Modified_Time ?? null;
        appointmentStatus = reRead.record?.Status ?? null;
      }
    } catch {
      // Non-fatal: the reschedule succeeded; only the fresh marker is missing.
    }

    return fsmOk({
      appointmentId: input.appointmentId,
      modifiedTime,
      status: appointmentStatus,
      correlationId: input.correlationId,
      raw: updateRes.json,
    });
  } catch (error) {
    return fsmResultFromError(error, "zoho:updateFsmAppointment");
  }
}

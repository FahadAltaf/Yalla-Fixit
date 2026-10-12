import type { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { createFsmAppointment, updateFsmAppointment } from "@/lib/server/zoho/appointments";
import { createFsmWorkOrderCopy, findRecentFsmWorkOrderCopy } from "@/lib/server/zoho/work-order-copy";
import { fsmOk, type FsmResult } from "@/lib/server/zoho/fsm-client";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

export type SyncEntryRow = {
  id: string;
  entry_type: "existing_appointment" | "new_appointment" | "free_text";
  fsm_work_order_id: string | null;
  fsm_appointment_id: string | null;
  fsm_work_order_name?: string | null;
  fsm_appointment_name?: string | null;
  fsm_last_modified_marker: string | null;
  start_at: string;
  end_at: string;
  title: string | null;
  operating_date?: string;
  fsm_appointment_type?: string | null;
  fsm_schedule_type?: string | null;
  fsm_service_line_item_ids?: string[] | null;
  fsm_service_task_line_item_ids?: string[] | null;
  needs_sync?: boolean | null;
  // FR-15 (appointments): a copy that first needs its own work order in FSM.
  fsm_create_work_order?: boolean | null;
  fsm_created_work_order_id?: string | null;
  fsm_copy_source_work_order_name?: string | null;
  fsm_copy_source_appointment_name?: string | null;
  fsm_copy_price?: number | string | null;
  fsm_work_order_create_started_at?: string | null;
  sync_status?: string | null;
};

// The columns syncEntryToFsm needs; use in .select() so nothing is missed.
// Needs migration 20261009120000 (the fsm_create_work_order columns).
export const SYNC_ENTRY_COLUMNS =
  "id, entry_type, fsm_work_order_id, fsm_appointment_id, fsm_work_order_name, fsm_appointment_name, fsm_last_modified_marker, start_at, end_at, title, operating_date, fsm_appointment_type, fsm_schedule_type, fsm_service_line_item_ids, fsm_service_task_line_item_ids, sync_status, needs_sync, fsm_create_work_order, fsm_created_work_order_id, fsm_copy_source_work_order_name, fsm_copy_source_appointment_name, fsm_copy_price, fsm_work_order_create_started_at";

// A short human label for an entry in sync results/toasts (WO2361 · AP-3148),
// so a failure can name exactly which appointment is the problem.
export function syncEntryLabel(entry: {
  entry_type: string;
  title?: string | null;
  fsm_work_order_name?: string | null;
  fsm_work_order_id?: string | null;
  fsm_appointment_name?: string | null;
  fsm_appointment_id?: string | null;
}): string {
  if (entry.entry_type === "free_text") return entry.title || "Text entry";
  const wo = entry.fsm_work_order_name || entry.fsm_work_order_id || "Work Order";
  const ap = entry.fsm_appointment_name || (entry.fsm_appointment_id ? "Appointment" : "Pending appointment");
  return `${wo} · ${ap}`;
}

// True when an entry actually needs writing to FSM on approval: a new
// appointment that hasn't been created yet, or one the scheduler edited.
// An already-synced, untouched appointment is skipped -- re-pushing it was
// failing on Zoho's post-create automation bump (YFI v1.5 note).
export function entryNeedsSync(entry: {
  entry_type: string;
  fsm_appointment_id?: string | null;
  needs_sync?: boolean | null;
}) {
  if (entry.entry_type === "free_text") return false;
  if (entry.entry_type === "new_appointment" && !entry.fsm_appointment_id) return true;
  return entry.needs_sync !== false;
}

export type SyncEntryResult = {
  entryId: string;
  status: "succeeded" | "skipped" | "failed";
  error?: string;
  // Human label of the entry (WO · AP), so callers can report exactly which
  // appointment failed without re-fetching.
  label?: string;
};

// A readable one-line reason from an FSM call's error body (AC-015).
function describeError(json: any, httpStatus: number): string {
  if (json?.error && typeof json.error === "string") {
    // FSM validation details are often nested; surface the first message.
    const detail =
      json?.details?.data?.[0]?.message ||
      json?.details?.message ||
      (Array.isArray(json?.details) ? json.details[0]?.message : undefined);
    return detail ? `${json.error}: ${detail}` : json.error;
  }
  return `Sync failed (HTTP ${httpStatus})`;
}

// Writes one FSM-backed entry to Zoho FSM (create for new_appointment,
// reschedule for existing/already-synced), records the attempt on
// schedule_audit_events, and updates the entry with the fresh Modified_Time
// marker so the reconcile job never mistakes this write for an external
// change. Free-text entries are skipped.
//
// Shared by approval (first attempt), retry (AC-006), and published-edit
// (AC-016) so all three stay consistent.
export async function syncEntryToFsm(
  admin: Admin,
  entry: SyncEntryRow,
  scheduleVersionId: string,
  operationType: "create_appointment" | "update_appointment" | "retry_sync" | "publish_edit",
): Promise<SyncEntryResult> {
  if (entry.entry_type === "free_text") {
    return { entryId: entry.id, status: "skipped", label: syncEntryLabel(entry) };
  }

  const { data: assignments } = await admin
    .from("schedule_entry_assignments")
    .select("technician_fsm_id")
    .eq("schedule_entry_id", entry.id);
  const serviceResourceIds = (assignments ?? []).map((a) => a.technician_fsm_id);

  if (serviceResourceIds.length === 0) {
    const error = "No technician assigned — assign at least one before syncing.";
    await recordFailure(admin, entry, scheduleVersionId, operationType, error, null);
    return { entryId: entry.id, status: "failed", error, label: syncEntryLabel(entry) };
  }

  const startedAt = new Date().toISOString();
  const creating = entry.entry_type === "new_appointment" && !entry.fsm_appointment_id;

  // FR-15 (appointments): a copy of an appointment to a later day gets its
  // own work order in FSM first (a copy of the lines the original covered),
  // then the appointment is created on that new work order. The new ids are
  // written to the entry BEFORE the appointment step, so a retry after an
  // appointment failure reuses the work order instead of making another.
  //
  // Two more guards, because a work order create is not idempotent:
  //  - the entry is claimed (sync_status = syncing) before anything is sent,
  //    so two approvals or retries at once cannot both create it;
  //  - fsm_work_order_create_started_at is set just before the POST; while
  //    it is set and no id is saved, the outcome is unknown (timeout, 5xx,
  //    a crash before the save), and FSM is searched for the work order
  //    before any new create.
  if (creating && entry.fsm_create_work_order && !entry.fsm_created_work_order_id) {
    const sourceWorkOrderId = entry.fsm_work_order_id as string;
    const sourceLineIds = entry.fsm_service_line_item_ids ?? [];
    const label = syncEntryLabel(entry);
    const fail = async (error: string, response: unknown): Promise<SyncEntryResult> => {
      await recordFailure(admin, entry, scheduleVersionId, operationType, error, response);
      return { entryId: entry.id, status: "failed", error, label };
    };

    const claimAt = new Date().toISOString();
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: claimed, error: claimError } = await admin
      .from("schedule_entries")
      .update({ sync_status: "syncing", updated_at: claimAt })
      .eq("id", entry.id)
      .is("fsm_created_work_order_id", null)
      .or(`sync_status.neq.syncing,updated_at.lt.${staleBefore}`)
      .select("id");
    if (claimError) return fail(`Could not claim the entry: ${claimError.message}`, null);
    if (!claimed || claimed.length === 0) {
      // Someone else holds it (or it was created meanwhile): report, do not
      // touch the entry.
      return {
        entryId: entry.id,
        status: "failed",
        error: "This copy is being created in Zoho FSM by another approval or retry. Wait a moment, then refresh.",
        label,
      };
    }

    let made: FsmResult | null = null;
    let adopted = false;
    if (entry.fsm_work_order_create_started_at) {
      const found = await findRecentFsmWorkOrderCopy({
        sourceWorkOrderId,
        dueDate: entry.operating_date ?? null,
        createdAfter: entry.fsm_work_order_create_started_at,
      });
      if (!found.ok) {
        return fail(
          `An earlier attempt to create this copy's work order has an unknown result, and Zoho FSM could not be checked: ${describeError(found.json, found.status)}`,
          found.json,
        );
      }
      const matches = (found.json.matches ?? []) as { id: string; name: string | null }[];
      if (matches.length > 1) {
        return fail(
          `Zoho FSM has ${matches.length} work orders that may belong to this copy (${matches.map((m) => m.name ?? m.id).join(", ")}). Cancel the extra ones in FSM, then retry.`,
          found.json,
        );
      }
      if (matches.length === 1) {
        made = fsmOk({ workOrderId: matches[0].id, workOrderName: matches[0].name, adopted: true });
        adopted = true;
      }
    }
    if (!made) {
      const createStartedAt = new Date().toISOString();
      const { error: markError } = await admin
        .from("schedule_entries")
        .update({ fsm_work_order_create_started_at: createStartedAt })
        .eq("id", entry.id);
      if (markError) return fail(`Could not record the attempt before creating the work order: ${markError.message}`, null);
      made = await createFsmWorkOrderCopy({
        sourceWorkOrderId,
        sourceLineIds,
        dueDate: entry.operating_date ?? null,
        correlationId: entry.id,
        expectedTotal:
          entry.fsm_copy_price !== null && entry.fsm_copy_price !== undefined ? Number(entry.fsm_copy_price) : null,
      });
    }
    const madeAt = new Date().toISOString();
    await admin.from("schedule_audit_events").insert({
      event_type: "sync_create_work_order",
      origin: "system",
      schedule_version_id: scheduleVersionId,
      schedule_entry_id: entry.id,
      affected_entity_type: "schedule_entry",
      affected_entity_id: entry.id,
      status: made.ok ? "succeeded" : "failed",
      correlation_id: entry.id,
      error_message: made.ok ? null : JSON.stringify(made.json),
      after_value: {
        response: made.json,
        adopted,
        source_work_order_id: sourceWorkOrderId,
        source_line_ids: sourceLineIds,
        startedAt,
        completedAt: madeAt,
      },
    });
    if (!made.ok) {
      const error = describeError(made.json, made.status);
      // FSM said no (a 4xx with a reason, or a pre-check): nothing was
      // created, so the next attempt may create. Anything else (timeout,
      // 5xx, no id in the answer) is unknown and keeps the marker.
      const fsmStatus = Number(made.json?.fsmStatus ?? 0);
      const definite = made.status === 409 || made.status === 404 || (fsmStatus >= 400 && fsmStatus < 500 && !made.json?.timedOut);
      if (definite) {
        await admin.from("schedule_entries").update({ fsm_work_order_create_started_at: null }).eq("id", entry.id);
      }
      return fail(
        definite ? error : `${error} The result is unknown; the next retry checks Zoho FSM for the work order before creating one.`,
        made.json,
      );
    }

    const newWorkOrderId = made.json.workOrderId as string;
    const newWorkOrderName = (made.json.workOrderName as string | null) ?? null;
    const { error: saveError } = await admin
      .from("schedule_entries")
      .update({
        fsm_created_work_order_id: newWorkOrderId,
        fsm_created_work_order_name: newWorkOrderName,
        fsm_work_order_id: newWorkOrderId,
        fsm_work_order_name: newWorkOrderName ?? newWorkOrderId,
        // The new work order holds only the copied lines, so the appointment
        // takes every line and every task on it; no id mapping to go wrong.
        fsm_service_line_item_ids: null,
        fsm_service_task_line_item_ids: null,
        updated_at: madeAt,
      })
      .eq("id", entry.id);
    if (saveError) {
      // The work order exists in FSM; the marker stays set, so the next
      // retry finds it there instead of creating another.
      return fail(
        `Work order ${newWorkOrderName ?? newWorkOrderId} was created in Zoho FSM but could not be saved on the entry: ${saveError.message}. Retry: it will be found in FSM, not created again.`,
        made.json,
      );
    }
    entry = {
      ...entry,
      fsm_created_work_order_id: newWorkOrderId,
      fsm_work_order_id: newWorkOrderId,
      fsm_work_order_name: newWorkOrderName ?? newWorkOrderId,
      fsm_service_line_item_ids: null,
      fsm_service_task_line_item_ids: null,
    };
  }

  const scheduleType = entry.fsm_schedule_type === "All Day" ? "All Day" : "Time-bound";
  const result = creating
    ? await createFsmAppointment({
        workOrderId: entry.fsm_work_order_id as string,
        scheduledStart: entry.start_at,
        scheduledEnd: entry.end_at,
        serviceResourceIds,
        summary: entry.title,
        correlationId: entry.id,
        serviceLineItemIds: entry.fsm_service_line_item_ids ?? undefined,
        serviceTaskLineItemIds: entry.fsm_service_task_line_item_ids ?? undefined,
        appointmentType: entry.fsm_appointment_type ?? undefined,
        scheduleType,
        appointmentDate: entry.operating_date,
      })
    : await updateFsmAppointment({
        appointmentId: entry.fsm_appointment_id as string,
        scheduledStart: entry.start_at,
        scheduledEnd: entry.end_at,
        serviceResourceIds,
        expectedModifiedTime: entry.fsm_last_modified_marker,
        correlationId: entry.id,
      });

  const completedAt = new Date().toISOString();

  // Sync attempts used to go to their own schedule_sync_operations table,
  // which duplicated what schedule_audit_events already recorded. They are
  // now one event stream; per-entry current state still lives on
  // schedule_entries (sync_status / last_sync_error / last_synced_at).
  await admin.from("schedule_audit_events").insert({
    event_type: `sync_${operationType}`,
    origin: "system",
    schedule_version_id: scheduleVersionId,
    schedule_entry_id: entry.id,
    affected_entity_type: "schedule_entry",
    affected_entity_id: entry.id,
    status: result.ok ? "succeeded" : "failed",
    correlation_id: entry.id,
    error_message: result.ok ? null : JSON.stringify(result.json),
    after_value: { response: result.json, startedAt, completedAt },
  });

  if (!result.ok) {
    const error = describeError(result.json, result.status);
    await admin
      .from("schedule_entries")
      .update({ sync_status: "failed", last_sync_error: error, updated_at: completedAt })
      .eq("id", entry.id);
    return { entryId: entry.id, status: "failed", error, label: syncEntryLabel(entry) };
  }

  // Success: capture the post-write Modified_Time as the new marker so
  // reconcile treats the record as unchanged, and clear any prior error.
  const newAppointmentId = creating ? result.json?.appointmentId ?? null : entry.fsm_appointment_id;
  const modifiedTime: string | null = result.json?.modifiedTime ?? null;

  const entryUpdate: Record<string, unknown> = {
    sync_status: "synced",
    last_sync_error: null,
    last_synced_at: completedAt,
    needs_sync: false,
    origin: "portal",
    updated_at: completedAt,
  };
  if (creating && newAppointmentId) entryUpdate.fsm_appointment_id = newAppointmentId;
  if (creating && result.json?.appointmentName) entryUpdate.fsm_appointment_name = result.json.appointmentName;
  if (modifiedTime) entryUpdate.fsm_last_modified_marker = modifiedTime;

  // The reconcile baseline is entry.fsm_last_modified_marker, set just above.
  // There was a parallel copy in fsm_appointment_snapshots, but nothing ever
  // read it -- reconcile compares against the entry -- so that table is gone.
  await admin.from("schedule_entries").update(entryUpdate).eq("id", entry.id);

  return { entryId: entry.id, status: "succeeded", label: syncEntryLabel(entry) };
}

async function recordFailure(
  admin: Admin,
  entry: SyncEntryRow,
  scheduleVersionId: string,
  operationType: string,
  error: string,
  responseSummary: unknown,
) {
  const now = new Date().toISOString();
  await admin.from("schedule_audit_events").insert({
    event_type: `sync_${operationType}`,
    origin: "system",
    schedule_version_id: scheduleVersionId,
    schedule_entry_id: entry.id,
    affected_entity_type: "schedule_entry",
    affected_entity_id: entry.id,
    status: "failed",
    correlation_id: entry.id,
    error_message: error,
    after_value: { response: responseSummary, startedAt: now, completedAt: now },
  });
  await admin
    .from("schedule_entries")
    .update({ sync_status: "failed", last_sync_error: error, updated_at: now })
    .eq("id", entry.id);
}

// Given the per-entry results, decide the version's overall status.
export function versionStatusFromResults(
  results: SyncEntryResult[],
): "published" | "partially_synced" | "sync_failed" {
  const synced = results.filter((r) => r.status === "succeeded").length;
  const failed = results.filter((r) => r.status === "failed").length;
  if (failed === 0) return "published";
  if (synced > 0) return "partially_synced";
  return "sync_failed";
}

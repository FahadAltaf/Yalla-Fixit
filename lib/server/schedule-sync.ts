import type { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { createFsmAppointment, updateFsmAppointment } from "@/lib/server/zoho/appointments";

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
};

// The columns syncEntryToFsm needs; use in .select() so nothing is missed.
export const SYNC_ENTRY_COLUMNS =
  "id, entry_type, fsm_work_order_id, fsm_appointment_id, fsm_work_order_name, fsm_appointment_name, fsm_last_modified_marker, start_at, end_at, title, operating_date, fsm_appointment_type, fsm_schedule_type, fsm_service_line_item_ids, fsm_service_task_line_item_ids, sync_status, needs_sync";

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
// schedule_sync_operations, and updates the entry with the fresh
// Modified_Time marker + snapshot so the reconcile job never mistakes this
// write for an external change. Free-text entries are skipped.
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

  await admin.from("schedule_sync_operations").insert({
    schedule_version_id: scheduleVersionId,
    schedule_entry_id: entry.id,
    operation_type: operationType,
    status: result.ok ? "succeeded" : "failed",
    correlation_id: entry.id,
    error_message: result.ok ? null : JSON.stringify(result.json),
    response_summary: result.json,
    started_at: startedAt,
    completed_at: completedAt,
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
    changed_in_fsm_at: null,
    changed_in_fsm_fields: null,
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
  await admin.from("schedule_sync_operations").insert({
    schedule_version_id: scheduleVersionId,
    schedule_entry_id: entry.id,
    operation_type: operationType,
    status: "failed",
    correlation_id: entry.id,
    error_message: error,
    response_summary: responseSummary,
    started_at: now,
    completed_at: now,
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

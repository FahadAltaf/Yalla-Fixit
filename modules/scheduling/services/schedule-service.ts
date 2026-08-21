import { executeRESTBackend } from "@/lib/rest-server";

export type ScheduleEntryType = "existing_appointment" | "new_appointment" | "free_text";
export type ShiftType = "day" | "night";

export interface ScheduleEntryAssignment {
  id: string;
  technician_fsm_id: string;
  technician_reference?: { display_name: string } | null;
}

export interface ScheduleEntry {
  id: string;
  schedule_version_id: string;
  entry_type: ScheduleEntryType;
  shift: ShiftType;
  operating_date: string;
  start_at: string;
  end_at: string;
  fsm_work_order_id: string | null;
  fsm_appointment_id: string | null;
  // Human-readable FSM labels (WO2361 / AP1043) -- what the grid shows.
  fsm_work_order_name: string | null;
  fsm_appointment_name: string | null;
  fsm_last_modified_marker: string | null;
  fsm_appointment_type: string | null;
  fsm_schedule_type: "Time-bound" | "All Day" | null;
  fsm_service_line_item_ids: string[] | null;
  fsm_service_task_line_item_ids: string[] | null;
  last_sync_error: string | null;
  last_synced_at: string | null;
  title: string | null;
  client_name: string | null;
  contact_name: string | null;
  address: string | null;
  notes: string | null;
  origin: "portal" | "fsm" | "system";
  sync_status: "not_ready" | "ready" | "syncing" | "synced" | "failed" | "review_required";
  changed_in_fsm_at: string | null;
  changed_in_fsm_fields: Record<string, unknown> | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_by_user?: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
  updated_by_user?: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
  schedule_entry_assignments?: ScheduleEntryAssignment[];
}

export type ScheduleVersionStatus =
  | "draft"
  | "pending_approval"
  | "rejected"
  | "approved_syncing"
  | "published"
  | "sync_failed"
  | "partially_synced"
  | "published_fsm_changed"
  | "draft_revision";

export interface ScheduleVersion {
  id: string;
  daily_schedule_id: string;
  version_number: number;
  status: ScheduleVersionStatus;
  parent_version_id: string | null;
  is_current: boolean;
  submitted_at: string | null;
  decided_at: string | null;
  decision: "approved" | "rejected" | null;
  decision_comment: string | null;
  published_at: string | null;
}

export interface DailySchedule {
  id: string;
  schedule_date: string;
  current_version_id: string | null;
}

export interface DayScheduleResponse {
  dailySchedule: DailySchedule | null;
  version: ScheduleVersion | null;
  entries: ScheduleEntry[];
}

export interface CreateEntryInput {
  scheduleVersionId: string;
  entryType: ScheduleEntryType;
  shift: ShiftType;
  operatingDate: string;
  startAt: string;
  endAt: string;
  technicianFsmIds: string[];
  title?: string | null;
  fsmWorkOrderId?: string;
  fsmAppointmentId?: string;
  fsmWorkOrderName?: string | null;
  fsmAppointmentName?: string | null;
  // new_appointment only: which lines it covers, its Type, Time-bound/All Day.
  serviceLineItemIds?: string[];
  serviceTaskLineItemIds?: string[];
  appointmentType?: string;
  scheduleType?: "Time-bound" | "All Day";
  clientName?: string | null;
  contactName?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface UpdateEntryInput {
  id: string;
  shift?: ShiftType;
  startAt?: string;
  endAt?: string;
  technicianFsmIds?: string[];
  title?: string | null;
  notes?: string | null;
}

export interface SchedulingAccess {
  userId: string;
  isApprover: boolean;
  canEdit: boolean;
}

export interface SchedulingConfig {
  org_timezone: string;
  night_shift_start: string;
  night_shift_end: string;
  day_shift_start: string;
  day_shift_end: string;
}

export const scheduleService = {
  getMe: async (): Promise<SchedulingAccess> => {
    return executeRESTBackend<SchedulingAccess>("/api/scheduling/me", { method: "GET" });
  },

  getConfig: async (): Promise<SchedulingConfig> => {
    return executeRESTBackend<SchedulingConfig>("/api/scheduling/config", { method: "GET" });
  },

  getDay: async (date: string): Promise<DayScheduleResponse> => {
    return executeRESTBackend<DayScheduleResponse>("/api/scheduling/schedule", {
      method: "GET",
      params: { date },
    });
  },

  addEntry: async (data: CreateEntryInput): Promise<ScheduleEntry> => {
    return executeRESTBackend<ScheduleEntry>("/api/scheduling/schedule/entries", {
      method: "POST",
      body: data as unknown as Record<string, unknown>,
    });
  },

  updateEntry: async (data: UpdateEntryInput): Promise<ScheduleEntry> => {
    return executeRESTBackend<ScheduleEntry>("/api/scheduling/schedule/entries", {
      method: "PUT",
      body: data as unknown as Record<string, unknown>,
    });
  },

  removeEntry: async (id: string): Promise<{ success: boolean }> => {
    return executeRESTBackend<{ success: boolean }>("/api/scheduling/schedule/entries", {
      method: "DELETE",
      params: { id },
    });
  },

  // Removes every entry from an editable draft in one action, so a
  // scheduler can restart a day without deleting entries one by one.
  clearDay: async (scheduleVersionId: string): Promise<{ removed: number }> => {
    return executeRESTBackend<{ removed: number }>("/api/scheduling/schedule/clear", {
      method: "POST",
      body: { scheduleVersionId },
    });
  },

  // E1: route the day to a chosen approver, or skipApproval to publish now.
  listApprovers: async (): Promise<Array<{ id: string; name: string; email: string }>> => {
    return executeRESTBackend("/api/scheduling/approvers", { method: "GET" });
  },

  submit: async (
    scheduleVersionId: string,
    options?: { approverId?: string | null; skipApproval?: boolean },
  ): Promise<{
    version: ScheduleVersion;
    published: boolean;
    results?: Array<{ entryId: string; status: string; error?: string; label?: string }>;
  }> => {
    return executeRESTBackend("/api/scheduling/schedule/submit", {
      method: "POST",
      body: {
        scheduleVersionId,
        approverId: options?.approverId ?? null,
        skipApproval: options?.skipApproval ?? false,
      },
    });
  },

  approve: async (
    scheduleVersionId: string,
    comment?: string,
  ): Promise<{ version: ScheduleVersion; results: Array<{ entryId: string; status: string; error?: string; label?: string }> }> => {
    return executeRESTBackend("/api/scheduling/schedule/approve", {
      method: "POST",
      body: { scheduleVersionId, comment: comment || null },
    });
  },

  reject: async (scheduleVersionId: string, reason: string): Promise<ScheduleVersion> => {
    return executeRESTBackend<ScheduleVersion>("/api/scheduling/schedule/reject", {
      method: "POST",
      body: { scheduleVersionId, reason },
    });
  },

  // #4: turn a rejected day back into an editable draft.
  reopen: async (scheduleVersionId: string): Promise<ScheduleVersion> => {
    return executeRESTBackend<ScheduleVersion>("/api/scheduling/schedule/reopen", {
      method: "POST",
      body: { scheduleVersionId },
    });
  },

  createRevision: async (dailyScheduleId: string): Promise<ScheduleVersion> => {
    return executeRESTBackend<ScheduleVersion>("/api/scheduling/schedule/revise", {
      method: "POST",
      body: { dailyScheduleId },
    });
  },

  // Adopt any direct Zoho FSM changes into the portal. Pass the operating
  // date to reconcile just that day (what the Refresh button does); omit it
  // to sweep every current version.
  reconcile: async (date?: string): Promise<{ checked: number; changed: number }> => {
    return executeRESTBackend<{ checked: number; changed: number }>("/api/scheduling/reconcile", {
      method: "POST",
      body: date ? { date } : {},
    });
  },

  // AC-006/AC-015: re-attempt FSM sync for entries that failed. Omit entryId
  // to retry every failed entry on the version.
  retrySync: async (
    scheduleVersionId: string,
    entryId?: string,
  ): Promise<{ version: ScheduleVersion; results: Array<{ entryId: string; status: string; error?: string; label?: string }> }> => {
    return executeRESTBackend("/api/scheduling/schedule/retry", {
      method: "POST",
      body: { scheduleVersionId, entryId: entryId ?? null },
    });
  },

  // AC-016: edit a published appointment's time/technicians and push to FSM.
  editPublished: async (data: {
    entryId: string;
    startAt: string;
    endAt: string;
    shift?: ShiftType;
    technicianFsmIds: string[];
  }): Promise<{ synced: boolean }> => {
    return executeRESTBackend("/api/scheduling/schedule/publish-edit", {
      method: "POST",
      body: data as unknown as Record<string, unknown>,
    });
  },

  getHistory: async (date: string): Promise<ScheduleVersionWithActions[]> => {
    return executeRESTBackend<ScheduleVersionWithActions[]>("/api/scheduling/history", {
      method: "GET",
      params: { date },
    });
  },

  getAudit: async (scheduleVersionId: string): Promise<AuditResponse> => {
    return executeRESTBackend<AuditResponse>("/api/scheduling/audit", {
      method: "GET",
      params: { scheduleVersionId },
    });
  },

  // E6: the appointments of a specific version (read-only, for history).
  getVersionEntries: async (scheduleVersionId: string): Promise<ScheduleEntry[]> => {
    return executeRESTBackend<ScheduleEntry[]>("/api/scheduling/schedule/version-entries", {
      method: "GET",
      params: { scheduleVersionId },
    });
  },
};

export interface ApprovalAction {
  id: string;
  action: "submitted" | "approved" | "rejected" | "withdrawn";
  actor_id: string | null;
  comment: string | null;
  created_at: string;
  user_profile?: { full_name: string | null; email: string } | null;
}

export interface ScheduleVersionWithActions extends ScheduleVersion {
  schedule_approval_actions: ApprovalAction[];
}

export interface AuditEvent {
  id: string;
  event_type: string;
  actor_id: string | null;
  origin: "portal" | "fsm" | "system";
  affected_entity_type: string | null;
  affected_entity_id: string | null;
  before_value: unknown;
  after_value: unknown;
  created_at: string;
  user_profile?: { full_name: string | null; email: string } | null;
}

export interface SyncOperation {
  id: string;
  schedule_entry_id: string | null;
  operation_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface AuditResponse {
  events: AuditEvent[];
  syncOperations: SyncOperation[];
}

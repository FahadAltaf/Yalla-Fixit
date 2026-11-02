// Append-only audit (FRD FR-13). Written and AWAITED before the response:
// if the audit row cannot be written, the action is reported as failed.
// Identity numbers reach here already masked (maskForAudit).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplianceActor } from "./access";

export type AuditEntityType =
  | "employee" | "identity" | "certificate" | "certificate_type" | "list" | "site" | "settings"
  | "role_requirement" | "identity_viewer" | "recipient" | "import" | "export" | "reminder_run" | "document";

export type AuditEventType =
  | "create" | "edit" | "archive" | "unarchive" | "reveal" | "export" | "import"
  | "import_rollback" | "hr_sync" | "grant" | "revoke" | "upload" | "open";

export type AuditEvent = {
  entity_type: AuditEntityType;
  entity_id?: string | null;
  employee_id?: string | null;
  event_type: AuditEventType;
  field?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  origin?: "portal" | "system" | "import" | "hr";
  import_batch_id?: string | null;
};

export async function recordComplianceAudit(
  admin: SupabaseClient,
  actor: ComplianceActor | null,
  event: AuditEvent,
): Promise<void> {
  const { error } = await admin.from("compliance_audit_events").insert({
    entity_type: event.entity_type,
    entity_id: event.entity_id ?? null,
    employee_id: event.employee_id ?? null,
    event_type: event.event_type,
    field: event.field ?? null,
    old_value: event.old_value === undefined ? null : event.old_value,
    new_value: event.new_value === undefined ? null : event.new_value,
    actor_id: actor?.id ?? null,
    actor_label: actor?.label ?? (event.origin === "system" ? "system" : null),
    origin: event.origin ?? "portal",
    import_batch_id: event.import_batch_id ?? null,
  });
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}

/** Several events for one action, in order; the first failure stops the rest. */
export async function recordComplianceAuditMany(
  admin: SupabaseClient,
  actor: ComplianceActor | null,
  events: AuditEvent[],
): Promise<void> {
  for (const event of events) await recordComplianceAudit(admin, actor, event);
}

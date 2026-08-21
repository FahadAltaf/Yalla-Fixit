import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only audit trail (BR-7, FR-4.04).
 *
 * The table itself refuses UPDATE and DELETE through a rule, so this
 * helper only ever inserts. Failures are logged and swallowed: losing
 * an audit row is bad, but failing the user's action because the audit
 * insert failed is worse, and the operation it describes has already
 * been committed by the time we get here.
 */

export type AuditEntry = {
  entityType:
    | "task"
    | "snag"
    | "area"
    | "photo"
    | "verification"
    | "submission"
    | "report"
    | "catalogue"
    | "token";
  entityId?: string | null;
  taskId?: string | null;
  eventType: string;
  actorId?: string | null;
  actorLabel?: string | null;
  origin?: "portal" | "mobile" | "system";
  /** BR-5: the written reason, on every rejection. */
  justification?: string | null;
  payload?: Record<string, unknown> | null;
};

const AUDIT_TABLE = "snagging_audit_events";

function toRow(entry: AuditEntry): Record<string, unknown> {
  return {
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    task_id: entry.taskId ?? null,
    event_type: entry.eventType,
    actor_id: entry.actorId ?? null,
    actor_label: entry.actorLabel ?? null,
    origin: entry.origin ?? "portal",
    justification: entry.justification ?? null,
    payload: entry.payload ?? null,
  };
}

/**
 * Records one audit event.
 *
 * Never throws: the action being audited has already committed by the
 * time we get here, so a lost audit row must not fail the user's request.
 * Failures are logged and swallowed.
 */
export async function recordAudit(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await admin.from(AUDIT_TABLE).insert(toRow(entry));
    if (error) console.error("snagging audit insert failed", error.message);
  } catch (error) {
    console.error("snagging audit insert threw", error);
  }
}

export async function recordAuditBatch(admin: SupabaseClient, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const { error } = await admin.from(AUDIT_TABLE).insert(entries.map(toRow));
    if (error) console.error("snagging audit batch insert failed", error.message);
  } catch (error) {
    console.error("snagging audit batch insert threw", error);
  }
}

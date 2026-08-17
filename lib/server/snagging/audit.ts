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

export async function recordAudit(
  admin: SupabaseClient,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await admin.from("snagging_audit_events").insert({
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    task_id: entry.taskId ?? null,
    event_type: entry.eventType,
    actor_id: entry.actorId ?? null,
    actor_label: entry.actorLabel ?? null,
    origin: entry.origin ?? "portal",
    justification: entry.justification ?? null,
    payload: entry.payload ?? null,
  });

  if (error) {
    console.error("snagging audit insert failed", entry.eventType, error.message);
  }
}

/** Batched form, for sync pushes that apply many mutations at once. */
export async function recordAuditBatch(
  admin: SupabaseClient,
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  const { error } = await admin.from("snagging_audit_events").insert(
    entries.map((entry) => ({
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      task_id: entry.taskId ?? null,
      event_type: entry.eventType,
      actor_id: entry.actorId ?? null,
      actor_label: entry.actorLabel ?? null,
      origin: entry.origin ?? "portal",
      justification: entry.justification ?? null,
      payload: entry.payload ?? null,
    })),
  );

  if (error) {
    console.error("snagging audit batch insert failed", error.message);
  }
}

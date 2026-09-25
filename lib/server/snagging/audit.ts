import { after } from "next/server";
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
    /* A quotation raised before any job exists has no task to hang off
       (BA v2, change 1), so it is audited against itself. */
    | "quotation"
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

/**
 * Writes the trail once the caller has their answer.
 *
 * Every action in the module ended with an audit insert in front of its
 * response -- a whole round trip to the database, on a connection where
 * one costs the better part of a second, for a row nobody is waiting on.
 * The action it describes is already committed by the time we get here,
 * so the reply does not need to wait for it.
 *
 * `after` only exists inside a request. A background sweep, a script, or
 * code already running in an after-callback has no response left to send,
 * so there the write is simply awaited as before.
 */
function writeAfterResponse(insert: () => Promise<void>): Promise<void> {
  try {
    after(insert);
    return Promise.resolve();
  } catch {
    return insert();
  }
}

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
export function recordAudit(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  return recordAuditBatch(admin, [entry]);
}

/**
 * Records several events in one insert.
 *
 * Also the single path every audit write takes (recordAudit calls this),
 * so "written after the response" is decided in one place.
 */
export function recordAuditBatch(
  admin: SupabaseClient,
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  return writeAfterResponse(async () => {
    try {
      const { error } = await admin.from(AUDIT_TABLE).insert(entries.map(toRow));
      if (error) console.error("snagging audit insert failed", error.message);
    } catch (error) {
      console.error("snagging audit insert threw", error);
    }
  });
}

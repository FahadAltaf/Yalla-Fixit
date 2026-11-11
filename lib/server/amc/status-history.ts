import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAmcAudit } from "@/lib/server/amc/audit";

/**
 * Status history for every AMC record (DEV-424, BRD 6.9: "who changed each
 * status and when"). One helper, one event type, one place to read it, so
 * enquiries, proposal versions, contracts, visits, call outs, payments and
 * additional works all keep the same trail in amc_audit_events.
 */

export interface StatusChange {
  entityType: string;
  entityId: string;
  from: string | null;
  to: string;
  reason?: string | null;
  actor: { id: string | null; label: string | null };
  origin?: "portal" | "client" | "system";
  /** Anything else worth keeping with the change (version, amounts…). */
  details?: Record<string, unknown>;
}

export const STATUS_CHANGED_EVENT = "status_changed";

export async function recordStatusChange(admin: SupabaseClient, change: StatusChange): Promise<void> {
  if (change.from === change.to) return;
  await recordAmcAudit(admin, {
    entityType: change.entityType,
    entityId: change.entityId,
    eventType: STATUS_CHANGED_EVENT,
    actorId: change.actor.id,
    actorLabel: change.actor.label,
    origin: change.origin ?? "portal",
    justification: change.reason ?? null,
    payload: { from: change.from, to: change.to, ...(change.details ?? {}) },
  });
}

export interface StatusHistoryItem {
  from: string | null;
  to: string;
  reason: string | null;
  actorLabel: string | null;
  origin: string;
  at: string;
  details: Record<string, unknown>;
}

export async function listStatusHistory(
  admin: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<StatusHistoryItem[]> {
  const { data, error } = await admin
    .from("amc_audit_events")
    .select("payload, justification, actor_label, origin, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("event_type", STATUS_CHANGED_EVENT)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { from = null, to = "", ...details } = (row.payload ?? {}) as Record<string, unknown>;
    return {
      from: (from as string | null) ?? null,
      to: String(to),
      reason: (row.justification as string | null) ?? null,
      actorLabel: (row.actor_label as string | null) ?? null,
      origin: String(row.origin ?? "portal"),
      at: String(row.created_at),
      details,
    };
  });
}

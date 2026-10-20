import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only audit trail for Finance & Reports (BRD §6.9): settings
 * changes now; waivers and dispute decisions in P7.
 *
 * The table refuses UPDATE, DELETE and TRUNCATE with an error (migration
 * 20261020100000). Like lib/server/amc/audit.ts, a failed insert is logged
 * rather than thrown: the change it describes is already committed, and
 * failing the user's request afterwards would only hide that it happened.
 */

export type ReportingAuditEntry = {
  entityType: "settings";
  entityId?: string | null;
  eventType: string;
  actorId?: string | null;
  actorLabel?: string | null;
  payload?: Record<string, unknown> | null;
};

const AUDIT_TABLE = "reporting_audit_events";

export async function recordReportingAudit(
  admin: SupabaseClient,
  entry: ReportingAuditEntry,
): Promise<void> {
  try {
    const { error } = await admin.from(AUDIT_TABLE).insert({
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      event_type: entry.eventType,
      actor_id: entry.actorId ?? null,
      actor_label: entry.actorLabel ?? null,
      payload: entry.payload ?? null,
    });
    if (error) console.error("[reporting:audit] insert failed:", error.message, entry.eventType);
  } catch (error) {
    console.error("[reporting:audit] insert threw:", error);
  }
}

export type ReportingSettingsHistoryEntry = {
  id: number;
  actorLabel: string | null;
  changedKeys: string[];
  createdAt: string;
};

/** The latest settings changes, newest first, for the History tab. */
export async function listReportingSettingsHistory(
  admin: SupabaseClient,
  limit = 25,
): Promise<ReportingSettingsHistoryEntry[]> {
  const { data, error } = await admin
    .from(AUDIT_TABLE)
    .select("id, actor_label, payload, created_at")
    .eq("entity_type", "settings")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  /* History is supporting detail: the settings still load without it. */
  if (error) {
    console.error("[reporting:audit] history read failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const keys = (row.payload as { changedKeys?: unknown } | null)?.changedKeys;
    return {
      id: Number(row.id),
      actorLabel: (row.actor_label as string | null) ?? null,
      changedKeys: Array.isArray(keys) ? keys.map(String) : [],
      createdAt: row.created_at as string,
    };
  });
}

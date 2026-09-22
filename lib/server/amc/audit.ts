import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only audit trail for the AMC module (FR5.9, FR6.5).
 *
 * Mirrors lib/server/snagging/audit.ts, including the swallow: the table
 * refuses UPDATE and DELETE through a rule, so this only ever inserts, and
 * a failed insert is logged rather than thrown. Losing an audit row is
 * bad; failing the user's action because the audit write failed is worse,
 * and by the time we get here the thing being described has already been
 * committed.
 */

export type AmcAuditEntry = {
  entityType: "submission" | "settings";
  entityId?: string | null;
  eventType: string;
  actorId?: string | null;
  actorLabel?: string | null;
  /** 'client' covers the tokenised links of FR5.5 and FR5.7, where the
   *  actor has no account. */
  origin?: "portal" | "client" | "system";
  /** FR5.2: the written reason, on every send-back. */
  justification?: string | null;
  payload?: Record<string, unknown> | null;
};

const AUDIT_TABLE = "amc_audit_events";

export async function recordAmcAudit(
  admin: SupabaseClient,
  entry: AmcAuditEntry,
): Promise<void> {
  try {
    const { error } = await admin.from(AUDIT_TABLE).insert({
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      event_type: entry.eventType,
      actor_id: entry.actorId ?? null,
      actor_label: entry.actorLabel ?? null,
      origin: entry.origin ?? "portal",
      justification: entry.justification ?? null,
      payload: entry.payload ?? null,
    });
    if (error) {
      console.error("[amc:audit] insert failed:", error.message, entry.eventType);
    }
  } catch (error) {
    console.error("[amc:audit] insert threw:", error);
  }
}

/**
 * Which settings keys changed, for FR6.5's "who changed what".
 *
 * Stores the key paths rather than the text: a clause can be thousands of
 * characters, and an audit row per edit carrying two copies of it would
 * make the table enormous without telling anyone more than the path does.
 */
export function diffSettingsKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix = "",
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];

  for (const key of keys) {
    const a = before?.[key];
    const b = after?.[key];
    const path = prefix ? `${prefix}.${key}` : key;

    const bothPlainObjects =
      a && b && typeof a === "object" && typeof b === "object" &&
      !Array.isArray(a) && !Array.isArray(b);

    if (bothPlainObjects) {
      changed.push(
        ...diffSettingsKeys(
          a as Record<string, unknown>,
          b as Record<string, unknown>,
          path,
        ),
      );
      continue;
    }

    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(path);
  }

  return changed;
}

export type AmcSettingsHistoryEntry = {
  id: number;
  actorLabel: string | null;
  changedKeys: string[];
  createdAt: string;
};

/**
 * FR6.5 — the latest settings changes, for the AMC Settings page. Recording
 * who changed what is only half of it; an admin also has to be able to see
 * it without going to the database.
 */
export async function listAmcSettingsHistory(
  admin: SupabaseClient,
  limit = 10,
): Promise<AmcSettingsHistoryEntry[]> {
  const { data, error } = await admin
    .from(AUDIT_TABLE)
    .select("id, actor_label, payload, created_at")
    .eq("entity_type", "settings")
    .order("created_at", { ascending: false })
    .limit(limit);

  /* History is supporting detail. If it cannot be read, the settings
     themselves still load. */
  if (error) {
    console.error("[amc:audit] history read failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const keys = (row.payload as { changedKeys?: unknown } | null)?.changedKeys;
    return {
      id: row.id as number,
      actorLabel: (row.actor_label as string | null) ?? null,
      changedKeys: Array.isArray(keys) ? keys.map(String) : [],
      createdAt: row.created_at as string,
    };
  });
}

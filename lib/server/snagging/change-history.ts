import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who changed what, and when, read from the append-only audit trail
 * (SNG-037).
 *
 * Quotations and the Snagging settings were already audited on every write
 * (generated, edited, regenerated, sent, decided; pricing, scope, terms,
 * catalogue and checklist changes), but nothing showed it, so the team had
 * no way to see who raised or last touched a quotation. This reads those
 * events back with the person's name resolved.
 */

export type ChangeHistoryScope = "quotation" | "settings";

export type ChangeHistoryItem = {
  id: number;
  eventType: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
  justification: string | null;
  payload: Record<string, unknown> | null;
};

type AuditRow = {
  id: number;
  event_type: string;
  actor_id: string | null;
  actor_label: string | null;
  justification: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const COLUMNS = "id, event_type, actor_id, actor_label, justification, payload, created_at";

/** Settings changes are all written as `catalogue` events (pricing, scope,
    terms, catalogue entries and checklist items). */
const SETTINGS_ENTITY = "catalogue";

export async function loadChangeHistory(
  admin: SupabaseClient,
  scope: ChangeHistoryScope,
  options: { id?: string; limit?: number } = {},
): Promise<ChangeHistoryItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  let query = admin
    .from("snagging_audit_events")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (scope === "quotation") {
    if (!options.id) return [];
    query = query.eq("entity_type", "quotation").eq("entity_id", options.id);
  } else {
    query = query.eq("entity_type", SETTINGS_ENTITY);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AuditRow[];
  const names = await actorNames(
    admin,
    rows.filter((row) => !row.actor_label && row.actor_id).map((row) => row.actor_id as string),
  );
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    actorId: row.actor_id,
    actorName: row.actor_label ?? (row.actor_id ? (names.get(row.actor_id) ?? null) : null),
    createdAt: row.created_at,
    justification: row.justification,
    payload: row.payload,
  }));
}

/** Names for a set of user ids, in one read. */
export async function actorNames(
  admin: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await admin
    .from("user_profile")
    .select("id, full_name, email")
    .in("id", unique);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      ((row.full_name as string | null) || (row.email as string | null) || "Unknown user") as string,
    ]),
  );
}

/**
 * Created by and last modified by for one quotation.
 *
 * Created by is the row's own `created_by`. Modified by is the person behind
 * the newest audit event after creation (an edit, a regenerate, a send, a
 * decision), so it needs no column of its own and is right for every
 * quotation already on file.
 */
export async function quotationAuthorship(
  admin: SupabaseClient,
  quotation: { id: string; created_by?: string | null; created_at?: string | null },
): Promise<{
  created_by_name: string | null;
  modified_by_name: string | null;
  modified_at: string | null;
}> {
  const { data, error } = await admin
    .from("snagging_audit_events")
    .select("actor_id, actor_label, event_type, created_at")
    .eq("entity_type", "quotation")
    .eq("entity_id", quotation.id)
    .neq("event_type", "quotation_generated")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const last = data as { actor_id: string | null; actor_label: string | null; created_at: string } | null;
  const names = await actorNames(
    admin,
    [quotation.created_by ?? "", last?.actor_label ? "" : (last?.actor_id ?? "")],
  );
  return {
    created_by_name: quotation.created_by ? (names.get(quotation.created_by) ?? null) : null,
    modified_by_name: last
      ? (last.actor_label ?? (last.actor_id ? (names.get(last.actor_id) ?? null) : "System"))
      : null,
    modified_at: last?.created_at ?? null,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AMC_CONFIG_DEFAULTS,
  diffAmcConfigSection,
  resolveAmcConfig,
  type AmcConfig,
  type AmcConfigSection,
  type ResolvedAmcConfig,
} from "@/lib/amc/config";
import { recordAmcAudit } from "@/lib/server/amc/audit";

/**
 * Server access to the AMC configuration (DEV-357). Only saved sections
 * are stored (`amc_config`); the code holds the defaults. Every save is
 * audited with the fields that changed and their old and new values.
 */

const TABLE = "amc_config";

/** A database without the Phase 1 migration answers with the defaults. */
const isMissingTable = (error: { code?: string; message?: string }) =>
  error.code === "42P01" ||
  error.code === "PGRST205" ||
  (/amc_config/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? ""));

export async function readAmcConfigResolved(admin: SupabaseClient): Promise<ResolvedAmcConfig & { migrated: boolean }> {
  const { data, error } = await admin.from(TABLE).select("key, value");
  if (error) {
    if (isMissingTable(error)) return { config: structuredClone(AMC_CONFIG_DEFAULTS) as AmcConfig, saved: [], invalid: [], migrated: false };
    throw new Error(error.message);
  }
  return { ...resolveAmcConfig((data ?? []) as Array<{ key: string; value: unknown }>), migrated: true };
}

export async function readAmcConfig(admin: SupabaseClient): Promise<AmcConfig> {
  return (await readAmcConfigResolved(admin)).config;
}

export class AmcConfigError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function writeAmcConfigSection<K extends AmcConfigSection>(
  admin: SupabaseClient,
  section: K,
  value: AmcConfig[K],
  actor: { id: string; label: string | null },
): Promise<{ changes: ReturnType<typeof diffAmcConfigSection> }> {
  const { config, migrated } = await readAmcConfigResolved(admin);
  if (!migrated) {
    throw new AmcConfigError("AMC configuration is not available yet: the Phase 1 database update has not been applied.", 503);
  }
  const before = config[section] as unknown as Record<string, unknown>;
  const changes = diffAmcConfigSection(before, value as unknown as Record<string, unknown>);
  if (changes.length === 0) return { changes };

  const { error } = await admin
    .from(TABLE)
    .upsert({ key: section, value, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);

  await recordAmcAudit(admin, {
    entityType: "config",
    entityId: null,
    eventType: "config_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { section, changes },
  });
  return { changes };
}

export interface AmcConfigHistoryItem {
  id: number;
  section: string;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
  actorLabel: string | null;
  createdAt: string;
}

export async function listAmcConfigHistory(admin: SupabaseClient, limit = 100): Promise<AmcConfigHistoryItem[]> {
  const { data, error } = await admin
    .from("amc_audit_events")
    .select("id, payload, actor_label, created_at")
    .eq("entity_type", "config")
    .eq("event_type", "config_updated")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => {
    const payload = (row.payload ?? {}) as { section?: string; changes?: AmcConfigHistoryItem["changes"] };
    return {
      id: Number(row.id),
      section: String(payload.section ?? ""),
      changes: Array.isArray(payload.changes) ? payload.changes : [],
      actorLabel: (row.actor_label as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  });
}

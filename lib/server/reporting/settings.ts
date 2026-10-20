import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getReportingSettingsDefaults,
  mergeReportingSettings,
  reportingSettingsOverridesSchema,
  type ReportingSettings,
  type ReportingSettingsOverrides,
} from "@/lib/reporting/settings";

/**
 * Server access to Reporting Settings. The table holds only an
 * administrator's changes; lib/reporting/settings.ts holds the defaults
 * and explains why.
 */

const SETTINGS_TABLE = "reporting_settings";
const SETTINGS_ROW_ID = 1;

export async function readReportingSettingsOverrides(
  admin: SupabaseClient,
): Promise<ReportingSettingsOverrides> {
  const { data, error } = await admin
    .from(SETTINGS_TABLE)
    .select("overrides")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);

  /* A missing row is not an error (the migration seeds one, but a database
     restored from before it should still work on the defaults). A row that
     no longer parses is dropped to the defaults and reported. */
  const parsed = reportingSettingsOverridesSchema.safeParse(data?.overrides ?? {});
  if (!parsed.success) {
    console.error("[reporting:settings] stored overrides do not parse; using defaults");
    return {};
  }
  return parsed.data;
}

/** The settings every report and alert uses: defaults plus the admin's changes. */
export async function readReportingSettings(admin: SupabaseClient): Promise<ReportingSettings> {
  const overrides = await readReportingSettingsOverrides(admin);
  const { settings, valid } = mergeReportingSettings(getReportingSettingsDefaults(), overrides);
  if (!valid) console.error("[reporting:settings] merged settings invalid; using defaults");
  return settings;
}

export async function writeReportingSettingsOverrides(
  admin: SupabaseClient,
  overrides: ReportingSettingsOverrides,
  actorId: string,
): Promise<ReportingSettingsOverrides> {
  const { data, error } = await admin
    .from(SETTINGS_TABLE)
    .upsert(
      { id: SETTINGS_ROW_ID, overrides, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    )
    .select("overrides")
    .single();
  if (error) throw new Error(error.message);
  return (data?.overrides ?? {}) as ReportingSettingsOverrides;
}

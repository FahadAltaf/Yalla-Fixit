import type { SupabaseClient } from "@supabase/supabase-js";
import { cachedRead, forgetCachedRead } from "@/lib/server/amc/read-cache";


import {
  amcSettingsOverridesSchema,
  getAmcSettingsDefaults,
  KNOWN_CLAUSE_ROLES,
  mergeAmcSettings,
  type AmcSettings,
  type AmcSettingsOverrides,
} from "@/components/dashboard/extensions/amc/amc-settings";

/**
 * Server-side access to the AMC settings document (FR6.1–FR6.4).
 *
 * The table holds only an admin's edits; the code holds the defaults. See
 * components/dashboard/extensions/amc/amc-settings.ts for why.
 */

const SETTINGS_TABLE = "amc_settings";
const SETTINGS_ROW_ID = 1;

export async function readAmcSettingsOverrides(
  admin: SupabaseClient,
): Promise<AmcSettingsOverrides> {
  const { data, error } = await admin
    .from(SETTINGS_TABLE)
    .select("overrides")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);

  /*
    A missing row is not an error. The migration seeds one, but a database
    restored from before it -- or a fresh branch -- should still render
    documents rather than fail; the defaults are complete on their own.
  */
  const parsed = amcSettingsOverridesSchema.safeParse(data?.overrides ?? {});
  return parsed.success ? parsed.data : {};
}

/** The live settings: shipped defaults with the admin's edits applied. */
/**
 * The settings as documents render them, kept for a few seconds per server
 * (read-cache.ts): every AMC request's access gate reads them. A save, and
 * the settings page (readAmcSettingsOverrides), read them fresh.
 */
export async function readAmcSettings(
  admin: SupabaseClient,
): Promise<AmcSettings> {
  return cachedRead(admin, "amc_settings", async () => {
    const overrides = await readAmcSettingsOverrides(admin);
    return mergeAmcSettings(getAmcSettingsDefaults(), overrides);
  });
}

export async function writeAmcSettingsOverrides(
  admin: SupabaseClient,
  overrides: AmcSettingsOverrides,
  actorId: string,
): Promise<AmcSettingsOverrides> {
  /*
    A saved clause list records which standard clauses existed when it was
    saved, so one added in a later release goes into it once, and one an
    admin takes out afterwards stays out (mergeAmcSettings).
  */
  const stored: AmcSettingsOverrides = overrides.clauseList?.length
    ? { ...overrides, knownRoles: [...KNOWN_CLAUSE_ROLES] }
    : overrides;
  const { data, error } = await admin
    .from(SETTINGS_TABLE)
    .upsert(
      {
        id: SETTINGS_ROW_ID,
        overrides: stored,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("overrides")
    .single();

  if (error) throw new Error(error.message);
  forgetCachedRead("amc_settings");
  return (data?.overrides ?? {}) as AmcSettingsOverrides;
}

/**
 * FR6.4 — freeze the current text onto a submission.
 *
 * Called at the moment a proposal is sent (phase 5). Everything the
 * document renders from is copied, so a later settings edit cannot alter
 * a document a client already holds.
 */
export async function snapshotAmcSettings(
  admin: SupabaseClient,
  submissionId: string,
): Promise<AmcSettings> {
  const settings = await readAmcSettings(admin);

  const { error } = await admin
    .from("amc_submissions")
    .update({ settings_snapshot: settings })
    .eq("id", submissionId)
    /* Only ever taken once. Re-sending must not re-freeze a document
       against text that has changed since the client first saw it. */
    .is("settings_snapshot", null);

  if (error) throw new Error(error.message);
  return settings;
}

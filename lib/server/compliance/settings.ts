// Module settings (FRD FR-8, FR-10, D11): one row, defaults until first saved.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplianceSettings } from "@/lib/compliance/types";

export const DEFAULT_SETTINGS: ComplianceSettings = {
  overdue_repeat_days: 7,
  hr_owned_groups: [],
  deactivation_request_user_ids: [],
};

export async function readSettings(admin: SupabaseClient): Promise<ComplianceSettings> {
  const { data, error } = await admin
    .from("compliance_settings")
    .select("overdue_repeat_days, hr_owned_groups, deactivation_request_user_ids")
    .eq("id", 1)
    .maybeSingle();
  // Missing table or column (migration not applied yet) reads as defaults.
  if (error) {
    if (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204") return DEFAULT_SETTINGS;
    throw new Error(error.message);
  }
  if (!data) return DEFAULT_SETTINGS;
  return {
    overdue_repeat_days: data.overdue_repeat_days ?? DEFAULT_SETTINGS.overdue_repeat_days,
    hr_owned_groups: data.hr_owned_groups ?? [],
    deactivation_request_user_ids: data.deactivation_request_user_ids ?? [],
  };
}

export async function writeSettings(
  admin: SupabaseClient,
  patch: Partial<ComplianceSettings>,
  actorId: string,
): Promise<{ before: ComplianceSettings; after: ComplianceSettings }> {
  const before = await readSettings(admin);
  const after = { ...before, ...patch };
  const { error } = await admin
    .from("compliance_settings")
    .upsert({ id: 1, ...after, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return { before, after };
}

/** Emails and names of the portal users in a settings list, skipping inactive users. */
export async function resolveUserRecipients(
  admin: SupabaseClient,
  userIds: string[],
): Promise<{ id: string; email: string; name: string }[]> {
  if (!userIds.length) return [];
  const { data, error } = await admin
    .from("user_profile")
    .select("id, email, full_name, first_name, last_name, is_active")
    .in("id", userIds);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((u: { email: string | null; is_active: boolean | null }) => u.email && u.is_active !== false)
    .map((u: { id: string; email: string; full_name: string | null; first_name: string | null; last_name: string | null }) => ({
      id: u.id,
      email: u.email,
      name: (u.full_name && u.full_name.trim()) || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
    }));
}

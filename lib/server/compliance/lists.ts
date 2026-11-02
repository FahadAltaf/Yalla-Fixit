// Designation and nationality lists in public.lookup_options (FRD section
// 6, plan decision). Same storage as technician roles and leave types; the
// module keeps its own keys and its own routes so scheduling code stays
// untouched. A value still used by an employee cannot be deleted.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LookupOption } from "@/lib/compliance/types";

export const COMPLIANCE_LIST_KEYS = {
  designation: "compliance_designation",
  nationality: "compliance_nationality",
} as const;

export type ComplianceListKey = keyof typeof COMPLIANCE_LIST_KEYS;

const EMPLOYEE_COLUMN: Record<ComplianceListKey, "designation_id" | "nationality_id"> = {
  designation: "designation_id",
  nationality: "nationality_id",
};

export function resolveListKey(value: string): ComplianceListKey | null {
  return value === "designation" || value === "nationality" ? value : null;
}

export async function listOptions(admin: SupabaseClient, key: ComplianceListKey): Promise<LookupOption[]> {
  const { data, error } = await admin
    .from("lookup_options")
    .select("id, name, sort_order")
    .eq("list_key", COMPLIANCE_LIST_KEYS[key])
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LookupOption[];
}

export async function createOption(
  admin: SupabaseClient,
  key: ComplianceListKey,
  name: string,
  actorId: string,
): Promise<LookupOption | "duplicate"> {
  const { data, error } = await admin
    .from("lookup_options")
    .insert({ list_key: COMPLIANCE_LIST_KEYS[key], name, created_by: actorId, updated_by: actorId })
    .select("id, name, sort_order")
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(error.message);
  }
  return data as LookupOption;
}

/** Find-or-create by name, case-insensitive. Used by the import. */
export async function ensureOption(admin: SupabaseClient, key: ComplianceListKey, name: string, actorId: string | null): Promise<LookupOption> {
  const trimmed = name.trim();
  const { data: existing, error } = await admin
    .from("lookup_options")
    .select("id, name, sort_order")
    .eq("list_key", COMPLIANCE_LIST_KEYS[key])
    .ilike("name", trimmed)
    .limit(1);
  if (error) throw new Error(error.message);
  if (existing && existing[0]) return existing[0] as LookupOption;
  const created = await createOption(admin, key, trimmed, actorId ?? "");
  if (created === "duplicate") throw new Error(`Race creating ${key} "${trimmed}"`);
  return created;
}

export async function renameOption(
  admin: SupabaseClient,
  key: ComplianceListKey,
  id: string,
  name: string,
  actorId: string,
): Promise<{ before: LookupOption; after: LookupOption } | "duplicate" | "missing"> {
  const { data: before } = await admin.from("lookup_options").select("id, name, sort_order").eq("id", id).eq("list_key", COMPLIANCE_LIST_KEYS[key]).maybeSingle();
  if (!before) return "missing";
  const { data, error } = await admin
    .from("lookup_options")
    .update({ name, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, name, sort_order")
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(error.message);
  }
  return { before: before as LookupOption, after: data as LookupOption };
}

export async function deleteOption(
  admin: SupabaseClient,
  key: ComplianceListKey,
  id: string,
): Promise<"deleted" | "in_use" | "missing"> {
  const { count, error: countError } = await admin
    .from("compliance_employees")
    .select("id", { count: "exact", head: true })
    .eq(EMPLOYEE_COLUMN[key], id);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) return "in_use";
  const { data, error } = await admin.from("lookup_options").delete().eq("id", id).eq("list_key", COMPLIANCE_LIST_KEYS[key]).select("id");
  if (error) throw new Error(error.message);
  return data && data.length > 0 ? "deleted" : "missing";
}

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The portal accounts a person may be picked from: active, and not hidden
 * from lists (DEV-458). Every people picker built for Finance & Reports
 * reads this; the Users admin list does not, so a hidden account is still
 * found and managed there.
 */

export type PickableUser = { id: string; name: string; email: string };

/** Filter half of the rule, shared with pickers that query for themselves. */
export function isPickable(row: { is_active?: boolean | null; hidden_from_lists?: boolean | null }): boolean {
  return row.is_active !== false && row.hidden_from_lists !== true;
}

export async function listPickableUsers(admin: SupabaseClient): Promise<PickableUser[]> {
  const { data, error } = await admin
    .from("user_profile")
    .select("id, email, full_name, is_active, hidden_from_lists")
    .order("full_name", { ascending: true })
    .order("id", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  return (data ?? []).filter(isPickable).map((row) => {
    const email = String(row.email ?? "").trim();
    return { id: row.id as string, email, name: String(row.full_name ?? "").trim() || email };
  });
}

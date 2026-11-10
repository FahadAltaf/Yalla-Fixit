import type { SupabaseClient } from "@supabase/supabase-js";

import { buildUserFromAccess, hasResourceAction, type RoleAccessEntry } from "@/lib/role-permissions";
import type { ActionType, ResourceType } from "@/types/types";

/**
 * Who a Finance notification goes to: the active people whose role holds a
 * permission. The same check as every route (hasResourceAction), so an
 * administrator receives the named-person ones (verify an exclusion) only
 * when granted them, like anyone else.
 */

export type Recipient = { userId: string; email: string | null; name: string };

type Row = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean | null;
  roles: { name?: string | null; role_access?: RoleAccessEntry[] | null } | { name?: string | null; role_access?: RoleAccessEntry[] | null }[] | null;
};

/** The rule alone, for tests. */
export function holdersOf(rows: Row[], resource: ResourceType, action: ActionType): Recipient[] {
  return rows
    .filter((row) => row.is_active !== false)
    .filter((row) => {
      const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
      const user = buildUserFromAccess({ id: row.id, roles: { name: role?.name ?? null } }, role?.role_access ?? []);
      return hasResourceAction(user, resource, action);
    })
    .map((row) => ({ userId: row.id, email: row.email, name: (row.full_name ?? "").trim() || (row.email ?? "") }));
}

export async function usersHolding(
  admin: SupabaseClient,
  resource: ResourceType,
  action: ActionType,
): Promise<Recipient[]> {
  const { data, error } = await admin
    .from("user_profile")
    .select("id, email, full_name, is_active, roles(name, role_access(resource, action, enabled))")
    .limit(1000);
  if (error) throw new Error(error.message);
  return holdersOf((data ?? []) as unknown as Row[], resource, action);
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { readAllRows } from "@/lib/server/snagging/read-all";
import { ActionType, ResourceType, UserRoles } from "@/types/types";

/**
 * Who may be put on snagging work: the people with access to the module.
 *
 * Every staff picker in Snagging (inspectors, approval manager, reviewer)
 * used to list every profile in the company. Most of them cannot open
 * Snagging at all: assign one as an inspector and the job never reaches
 * their phone; name one as approval manager and the report waits on
 * somebody who cannot see it. The lists now hold only the people the work
 * can actually go to.
 *
 * "Access" is what the permission check itself means by it
 * (hasResourceAction): the admin role, or a role with Snagging's View
 * permission switched on. Deactivated people are left out.
 */
export type SnaggingStaff = {
  id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean | null;
};

/** The roles that can open Snagging: admin, and any role granted its View. */
async function rolesWithAccess(admin: SupabaseClient): Promise<string[]> {
  const [{ data: adminRoles, error: roleError }, { data: grants, error: grantError }] =
    await Promise.all([
      admin.from("roles").select("id").eq("name", UserRoles.ADMIN),
      admin
        .from("role_access")
        .select("role_id, enabled")
        .eq("resource", ResourceType.SNAGGING)
        .eq("action", ActionType.VIEW),
    ]);
  if (roleError) throw new Error(roleError.message);
  if (grantError) throw new Error(grantError.message);

  return [
    ...new Set([
      ...(adminRoles ?? []).map((row) => row.id as string),
      // A row with `enabled` unset counts as granted, as it does for the check.
      ...(grants ?? [])
        .filter((row) => row.enabled !== false)
        .map((row) => row.role_id as string),
    ]),
  ];
}

/** Everyone active with access to Snagging, by name. */
export async function listSnaggingStaff(admin: SupabaseClient): Promise<SnaggingStaff[]> {
  const roleIds = await rolesWithAccess(admin);
  if (roleIds.length === 0) return [];

  const rows = await readAllRows<SnaggingStaff>(
    (from, to) =>
      admin
        .from("user_profile")
        .select("id, full_name, email, is_active")
        .in("role_id", roleIds)
        .order("full_name", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to),
    "snagging staff",
  );
  return rows.filter((row) => row.is_active !== false);
}

/**
 * Which of these people cannot be given snagging work, by name, for an
 * error message. Empty when all of them can.
 */
export async function staffWithoutAccess(
  admin: SupabaseClient,
  userIds: string[],
): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];

  const [roleIds, { data, error }] = await Promise.all([
    rolesWithAccess(admin),
    admin.from("user_profile").select("id, full_name, email, role_id, is_active").in("id", ids),
  ]);
  if (error) throw new Error(error.message);

  const allowed = new Set(roleIds);
  const found = new Map((data ?? []).map((row) => [row.id as string, row]));
  return ids
    .filter((id) => {
      const row = found.get(id);
      return !row || row.is_active === false || !allowed.has(row.role_id as string);
    })
    .map((id) => {
      const row = found.get(id);
      return (row?.full_name as string | null) || (row?.email as string | null) || "Someone";
    });
}

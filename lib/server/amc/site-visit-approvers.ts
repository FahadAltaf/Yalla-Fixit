import type { SupabaseClient } from "@supabase/supabase-js";

import { ContractError } from "@/lib/server/amc/contracts";
import { ActionType, ResourceType, UserRoles } from "@/types/types";

/**
 * Who can approve a site visit (16 Nov 2026): people whose role can approve
 * in AMC (admin, or a role granted AMC Approve). Kept apart from the
 * approval itself so the booking code can check an approver without a
 * circular import.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The roles that can approve in AMC: admin, and any role granted AMC Approve. */
async function approverRoleIds(admin: Admin): Promise<string[]> {
  const [{ data: adminRoles, error: roleError }, { data: grants, error: grantError }] = await Promise.all([
    admin.from("roles").select("id").eq("name", UserRoles.ADMIN),
    admin.from("role_access").select("role_id, enabled").eq("resource", ResourceType.AMC).eq("action", ActionType.APPROVE),
  ]);
  if (roleError) throw new ContractError(roleError.message, 500);
  if (grantError) throw new ContractError(grantError.message, 500);
  return [
    ...new Set([
      ...((adminRoles ?? []) as Row[]).map((r) => String(r.id)),
      /* A grant with `enabled` unset counts as granted, as the permission check reads it. */
      ...((grants ?? []) as Row[]).filter((r) => r.enabled !== false).map((r) => String(r.role_id)),
    ]),
  ];
}

/** Everyone active who can approve a site visit, by name. */
export async function listSiteVisitApprovers(admin: Admin): Promise<Array<{ id: string; name: string; email: string | null }>> {
  const roleIds = await approverRoleIds(admin);
  if (!roleIds.length) return [];
  const { data, error } = await admin
    .from("user_profile")
    .select("id, full_name, email, is_active, hidden_from_lists")
    .in("role_id", roleIds)
    .order("full_name");
  if (error) throw new ContractError(error.message, 500);
  return ((data ?? []) as Row[])
    .filter((u) => u.is_active !== false && u.hidden_from_lists !== true)
    .map((u) => ({ id: String(u.id), name: str(u.full_name) ?? str(u.email) ?? "User", email: str(u.email) }));
}

/** The approver's name, after checking they can approve in AMC. */
export async function approverName(admin: Admin, userId: string): Promise<string> {
  const [roleIds, { data: person, error }] = await Promise.all([
    approverRoleIds(admin),
    admin.from("user_profile").select("full_name, email, role_id, is_active").eq("id", userId).maybeSingle<Row>(),
  ]);
  if (error) throw new ContractError(error.message, 500);
  if (!person || person.is_active === false) throw new ContractError("The approver must be an active portal user.", 400);
  if (!roleIds.includes(String(person.role_id))) throw new ContractError("The approver must be someone who can approve in AMC.", 400);
  return str(person.full_name) ?? str(person.email) ?? "User";
}


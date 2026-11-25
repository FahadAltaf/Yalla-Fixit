import type { SupabaseClient } from "@supabase/supabase-js";

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";

/*
  The people AMC can name or assign (23 Nov 2026), with what each one's role
  lets them do, so every AMC dropdown lists only people who hold the
  permission for that job: an enquiry owner can open enquiries, a site visit
  inspector can open site visits, Finance can open payments, and so on.
  Admins hold everything. Switched-off users and accounts hidden from lists
  are left out, unless already chosen somewhere (`keep`), so a save never
  drops someone silently.
*/

type Admin = SupabaseClient;
type RoleRow = { name?: string | null; role_access?: Array<{ resource: string; action: string; enabled?: boolean | null }> | null };
type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean | null;
  hidden_from_lists?: boolean | null;
  roles: RoleRow | RoleRow[] | null;
};

/** What a person may be chosen for. */
export interface AmcPersonCan {
  /** Any AMC access (the AMC menu). */
  amc: boolean;
  /** Own enquiries (AMC Enquiries). */
  enquiries: boolean;
  /** Do site visits (AMC Site visits or AMC Visits). */
  siteVisits: boolean;
  /** Approve proposals (AMC Approve, or AMC Proposals to reach the approval queue). */
  approve: boolean;
  /** Finance (AMC Payments). */
  payments: boolean;
  /** Supervise visits and job sheets (AMC Visits). */
  visits: boolean;
  /** Contracts (AMC Contracts or every contract). */
  contracts: boolean;
  /** Sign in to the YFI mobile app (where technicians do visits and site visits). */
  mobile: boolean;
}

export interface AmcPerson {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  can: AmcPersonCan;
}

/** What one user_profile row (with roles(name, role_access)) may be chosen for. */
export function canOf(row: Pick<UserRow, "roles">): AmcPersonCan {
  const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
  const user = { roles: { name: role?.name ?? null, role_accessCollection: { edges: (role?.role_access ?? []).map((node) => ({ node })) } } } as never;
  const has = (resource: ResourceType, action: ActionType = ActionType.VIEW) => hasResourceAction(user, resource, action);
  return {
    amc: canUseAmc(user),
    enquiries: has(ResourceType.AMC_ENQUIRIES),
    siteVisits: has(ResourceType.AMC_SITE_VISITS) || has(ResourceType.AMC_VISITS),
    approve: has(ResourceType.AMC, ActionType.APPROVE) || has(ResourceType.AMC_PROPOSALS),
    payments: has(ResourceType.AMC_PAYMENTS),
    visits: has(ResourceType.AMC_VISITS) || has(ResourceType.AMC_VISITS, ActionType.APPROVE),
    contracts: has(ResourceType.AMC_CONTRACTS) || has(ResourceType.AMC_OPERATIONS),
    mobile: has(ResourceType.MOBILE_APP),
  };
}

/** Everyone with AMC access (or already chosen), each with what they may be chosen for. */
export async function amcPeople(admin: Admin, keep: Iterable<string> = []): Promise<AmcPerson[]> {
  const kept = new Set(keep);
  const { data, error } = await admin
    .from("user_profile")
    .select("id, email, full_name, is_active, hidden_from_lists, roles(name, role_access(resource, action, enabled))")
    .order("full_name", { ascending: true })
    .limit(2000);
  if (error) return [];
  return ((data ?? []) as UserRow[])
    .map((u) => ({ row: u, can: canOf(u) }))
    .filter(({ row, can }) => kept.has(row.id) || (row.is_active !== false && row.hidden_from_lists !== true && can.amc))
    .map(({ row, can }) => {
      const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
      return { id: row.id, name: row.full_name?.trim() || row.email || "User", email: row.email, role: role?.name ?? null, can };
    });
}

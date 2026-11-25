import type { SupabaseClient } from "@supabase/supabase-js";

import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { amcSelfApprovalOn } from "@/lib/amc/workflow";
import { readAmcConfig } from "@/lib/server/amc/config";
import { ContractError } from "@/lib/server/amc/contracts";
import { readAmcSettings } from "@/lib/server/amc/settings";
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

export type ConfiguredDeciders = { ids: string[]; names: string[]; from: string };

/**
 * Who decides a request that has no approval ladder of its own (24 Nov
 * 2026), from AMC configuration: the level 1 approvers, else level 2, else
 * level 3, else the AMC approvers (all levels) from AMC settings. Contract
 * amendments and site visits both use it. The requester is left out unless
 * an approver may approve their own request (Sami, 24 Nov 2026).
 */
export async function configuredDeciders(admin: Admin, config: AmcConfig, requesterId: string | null): Promise<ConfiguredDeciders> {
  const notRequester = (ids: string[]) => ids.filter((u) => u && (amcSelfApprovalOn() || u !== requesterId));
  let ids: string[] = [];
  let from = "";
  for (const level of [1, 2, 3]) {
    ids = notRequester(approversForLevel(config, level));
    if (ids.length) {
      from = `${level === 1 ? config.approvals.level1Name || "Level 1" : level === 2 ? config.approvals.level2Name || "Level 2" : config.approvals.level3Name || "Level 3"} approvers`;
      break;
    }
  }
  let people: Row[] = [];
  if (ids.length) {
    const { data } = await admin.from("user_profile").select("id, full_name, email").in("id", ids);
    people = (data ?? []) as Row[];
  } else {
    const settings = await readAmcSettings(admin).catch(() => null);
    const emails = [...new Set((settings?.approval?.approvers ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (emails.length) {
      const { data } = await admin.from("user_profile").select("id, full_name, email").in("email", emails);
      people = ((data ?? []) as Row[]).filter((u) => amcSelfApprovalOn() || String(u.id) !== requesterId);
      ids = people.map((u) => String(u.id));
      from = "AMC approvers (all levels)";
    }
  }
  const names = ids.map((id) => {
    const u = people.find((p) => String(p.id) === id);
    return (str(u?.full_name) ?? str(u?.email) ?? "User") as string;
  });
  return { ids, names, from };
}

/**
 * Who approves a site visit (24 Nov 2026, the user: "we already define it in
 * AMC configuration"): nobody is picked when booking any more; the people
 * named in AMC configuration decide, as for an amendment. With nobody named
 * anywhere, anyone whose role can approve in AMC, so a visit is never stuck.
 */
export async function siteVisitDeciders(admin: Admin): Promise<ConfiguredDeciders> {
  const config = await readAmcConfig(admin).catch(() => null);
  const named = config ? await configuredDeciders(admin, config, null) : { ids: [], names: [], from: "" };
  if (named.ids.length) return named;
  const anyone = await listSiteVisitApprovers(admin);
  return { ids: anyone.map((p) => p.id), names: anyone.map((p) => p.name), from: "anyone who can approve in AMC" };
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


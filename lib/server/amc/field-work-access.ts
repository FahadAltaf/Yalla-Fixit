import type { SupabaseClient } from "@supabase/supabase-js";

import { canOperateContract, canReadContract } from "@/lib/amc/access";
import type { ContractGate } from "@/lib/server/amc/contract-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Who may do what with call outs and additional works (Phase 11). Each has
 * its own page permission (as every AMC page): View sees them all, Create
 * logs, Edit works on them. The contract's owner and whoever operates it
 * may do the same on that contract. Booking a chargeable call out as
 * covered is AMC Allowances (Approve).
 */

type Gate = Extract<ContractGate, { ok: true }>;
export type FieldWork = "call_outs" | "additional_works";

const RESOURCE: Record<FieldWork, ResourceType> = {
  call_outs: ResourceType.AMC_CALL_OUTS,
  additional_works: ResourceType.AMC_ADDITIONAL_WORKS,
};

export function fieldWorkRights(gate: Gate, kind: FieldWork, ownerId: string | null) {
  const r = RESOURCE[kind];
  const operates = canOperateContract(gate.actor, ownerId);
  return {
    seesAll: gate.can(r, ActionType.VIEW) || gate.seesAll,
    view: gate.can(r, ActionType.VIEW) || gate.seesAll || canReadContract(gate.actor, ownerId),
    create: gate.can(r, ActionType.CREATE) || operates,
    edit: gate.can(r, ActionType.EDIT) || operates,
    override: Boolean(gate.actor.allowanceOverride),
  };
}

/** The owner of a contract's source proposal (null when not found). */
export async function contractOwner(admin: SupabaseClient, contractId: string): Promise<{ found: boolean; ownerId: string | null }> {
  const { data } = await admin
    .from("amc_contracts")
    .select("id, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id)")
    .eq("id", contractId)
    .maybeSingle<Record<string, unknown>>();
  if (!data) return { found: false, ownerId: null };
  const s = Array.isArray(data.submission) ? data.submission[0] : data.submission;
  const owner = (s as { owner_id?: string | null } | null)?.owner_id;
  return { found: true, ownerId: typeof owner === "string" ? owner : null };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

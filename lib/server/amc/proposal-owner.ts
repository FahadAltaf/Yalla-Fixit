import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError } from "@/lib/server/amc/contracts";

/*
  A proposal handed to someone else, or taken over (DEV-368, 20 Nov 2026
  review: "a colleague cannot take over a proposal ... the owner cannot be
  changed"). The new owner is anyone who can work on proposals: an admin,
  or a role with AMC, AMC Proposals or AMC Operations rights. The change is
  logged on the proposal's history with who did it and from whom to whom.
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

const PROPOSAL_RESOURCES = new Set(["amc", "amc_proposals", "amc_operations"]);

export interface ProposalOwnerCandidate {
  id: string;
  name: string;
  email: string;
}

export async function proposalOwnerCandidates(admin: Admin): Promise<ProposalOwnerCandidate[]> {
  const { data, error } = await admin
    .from("user_profile")
    .select("id, email, full_name, is_active, hidden_from_lists, roles(name, role_access(resource, action, enabled))")
    .order("full_name", { ascending: true })
    .limit(2000);
  if (error) throw new ContractError(`Could not list the team: ${error.message}`, 500);
  type RoleRow = { name?: string | null; role_access?: { resource: string; action: string; enabled?: boolean | null }[] | null };
  return ((data ?? []) as Row[])
    .filter((u) => u.is_active !== false && u.hidden_from_lists !== true)
    .filter((u) => {
      const joined = u.roles as RoleRow | RoleRow[] | null;
      const role = Array.isArray(joined) ? joined[0] : joined;
      if (role?.name === "admin") return true;
      return (role?.role_access ?? []).some((a) => PROPOSAL_RESOURCES.has(a.resource) && a.enabled !== false && ["view", "edit", "approve", "create"].includes(a.action));
    })
    .map((u) => ({ id: String(u.id), email: String(u.email ?? ""), name: (String(u.full_name ?? "").trim() || String(u.email ?? "")).trim() }));
}

export async function changeProposalOwner(admin: Admin, proposalId: string, newOwnerId: string, actor: { id: string; label: string | null }) {
  const { data: p, error } = await admin.from("amc_submissions").select("id, owner_id, proposal_number, status").eq("id", proposalId).maybeSingle<Row>();
  if (error) throw new ContractError(error.message, 500);
  if (!p) throw new ContractError("Proposal not found.", 404);
  if (String(p.owner_id) === newOwnerId) throw new ContractError("That person already owns this proposal.", 409);
  if (p.status === "cancelled") throw new ContractError("A cancelled proposal keeps its owner.", 409);
  const candidates = await proposalOwnerCandidates(admin);
  const next = candidates.find((c) => c.id === newOwnerId);
  if (!next) throw new ContractError("That person cannot work on AMC proposals: give their role AMC Proposals access first.", 400);
  const { data: prevUser } = await admin.from("user_profile").select("full_name, email").eq("id", String(p.owner_id)).maybeSingle<Row>();
  const previousName = (String(prevUser?.full_name ?? "").trim() || String(prevUser?.email ?? "")) || null;
  const { data: updated, error: upError } = await admin
    .from("amc_submissions")
    .update({ owner_id: newOwnerId, updated_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("owner_id", String(p.owner_id))
    .select("id");
  if (upError) throw new ContractError(upError.message, 500);
  if (!updated?.length) throw new ContractError("The owner changed a moment ago. Reload and try again.", 409);
  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: proposalId,
    eventType: newOwnerId === actor.id ? "owner_taken_over" : "owner_changed",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { from: String(p.owner_id), fromName: previousName, to: newOwnerId, toName: next.name },
  });
  return { ok: true as const, ownerId: newOwnerId, ownerName: next.name };
}

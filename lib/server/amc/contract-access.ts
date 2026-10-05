import { NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ContractError, loadContract } from "@/lib/server/amc/contracts";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Who may do what with AMC contracts. The same people as AMC proposals:
 *
 *   view          AMC users see contracts from their own proposals;
 *                 approvers (AMC Settings list, or AMC approve) see all
 *   activate      the proposal's owner, or an approver
 *   record usage  the proposal's owner, or an approver
 *   renew         the proposal's owner, or an approver
 *   cancel        approvers only
 *
 * BUSINESS DECISION REQUIRED: whether operations staff without AMC
 * proposal access should record usage. Until decided, usage follows the
 * proposal's owner and approvers.
 */
export type ContractGate =
  | {
      ok: true;
      admin: Awaited<ReturnType<typeof createAdminServerClient>>;
      userId: string;
      label: string | null;
      canApprove: boolean;
    }
  | { ok: false; response: NextResponse };

export async function requireContractAccess(): Promise<ContractGate> {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser || access.profile.is_active === false) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canUseAmc(access.accessUser)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const admin = await createAdminServerClient();
  let canApprove = false;
  try {
    canApprove = canApproveAmc(
      await readAmcSettings(admin),
      access.profile.email,
      hasResourceAction(access.accessUser, ResourceType.AMC, ActionType.APPROVE),
    );
  } catch {
    canApprove = false;
  }
  return {
    ok: true,
    admin,
    userId: access.profile.id,
    label: access.profile.full_name ?? access.profile.email ?? null,
    canApprove,
  };
}

/** Owner of the source proposal, or an approver. */
export function canManage(gate: Extract<ContractGate, { ok: true }>, ownerId: string | null): boolean {
  return gate.canApprove || (!!ownerId && ownerId === gate.userId);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads a contract for a route and checks the caller may work on it. Not
 * theirs reads as "not found", as for proposals.
 */
export async function requireManagedContract(gate: Extract<ContractGate, { ok: true }>, id: string) {
  const notFound = { ok: false as const, response: NextResponse.json({ error: "Contract not found." }, { status: 404 }) };
  if (!UUID.test(id)) return notFound;
  const loaded = await loadContract(gate.admin, id);
  if (!canManage(gate, loaded.ownerId)) return notFound;
  return { ok: true as const, ...loaded };
}

/** A ContractError becomes its own status; anything else is logged and a 500. */
export function contractErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof ContractError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`AMC contracts: ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

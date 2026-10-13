import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { createRenewalProposal } from "@/lib/server/amc/contracts";
import { renewalOverview } from "@/lib/server/amc/contract-operations";
import { readAmcConfig } from "@/lib/server/amc/config";
import { pastYearSummary } from "@/lib/server/amc/renewals";

/**
 * Renewal of a contract.
 *
 * GET: the renewal relationships (the contract it renewed, its renewal
 * proposal, the contract that replaced it) and, when a renewal can still be
 * started, a preview of what the proposal would copy and its price.
 *
 * POST: starts the renewal proposal, a normal draft in AMC proposals,
 * pre-filled and priced against the current settings. Nothing is sent and
 * the contract itself is not changed. One renewal proposal per contract.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id, "read");
    if (!contract.ok) return contract.response;
    const config = await readAmcConfig(gate.admin);
    /* Phase 13: the escalation on the draft, last year beside it, and the outcome so far. */
    const [renewal, pastYear, { data: outcome }] = await Promise.all([
      renewalOverview(gate.admin, id, config.renewals.escalationPercent),
      pastYearSummary(gate.admin, id),
      gate.admin.from("amc_contracts").select("renewal_outcome, renewal_outcome_reason, renewal_outcome_at, renewal_reminded_at").eq("id", id).maybeSingle(),
    ]);
    return NextResponse.json({ renewal, pastYear, outcome: outcome ?? null, canRecordOutcome: canOperateContract(gate.actor, contract.ownerId) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the renewal");
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const config = await readAmcConfig(gate.admin);
    const result = await createRenewalProposal(
      gate.admin,
      id,
      { id: gate.userId, label: gate.label },
      config.renewals.escalationPercent,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not start the renewal");
  }
}

import { NextRequest, NextResponse } from "next/server";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { createRenewalProposal } from "@/lib/server/amc/contracts";
import { renewalOverview } from "@/lib/server/amc/contract-operations";

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
    return NextResponse.json({ renewal: await renewalOverview(gate.admin, id) });
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
    const result = await createRenewalProposal(gate.admin, id, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not start the renewal");
  }
}

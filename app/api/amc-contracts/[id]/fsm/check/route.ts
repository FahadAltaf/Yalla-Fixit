import { NextRequest, NextResponse } from "next/server";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { checkContractFsm } from "@/lib/server/amc/fsm-integration";

// Reads up to 40 appointments from FSM, four at a time.
export const maxDuration = 60;

/**
 * Re-reads the contract's linked appointments from Zoho FSM and applies
 * the usage rules. While automation is off this only updates the sync log
 * (completed visits become "needs review"); nothing is consumed.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    return NextResponse.json(await checkContractFsm(gate.admin, id, { id: gate.userId, label: gate.label }));
  } catch (error) {
    return contractErrorResponse(error, "Could not check FSM");
  }
}

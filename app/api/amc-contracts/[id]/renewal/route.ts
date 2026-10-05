import { NextRequest, NextResponse } from "next/server";

import { canManage, requireContractAccess } from "@/lib/server/amc/contract-access";
import { ContractError, createRenewalProposal, loadContract } from "@/lib/server/amc/contracts";

/**
 * Starts a renewal proposal from a contract: a normal draft in AMC
 * proposals, pre-filled and priced against the current settings. Nothing
 * is sent and the contract itself is not changed.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const { ownerId } = await loadContract(gate.admin, id);
    if (!canManage(gate, ownerId)) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    }
    const result = await createRenewalProposal(gate.admin, id, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("AMC renewal failed:", error);
    return NextResponse.json({ error: "Could not start the renewal" }, { status: 500 });
  }
}

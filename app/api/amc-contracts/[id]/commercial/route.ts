import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { contractCommercialHistory } from "@/lib/server/amc/business";

/** The contract's commercial relationships: proposal, renewal, additional-service quotes and discounts offered. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    return NextResponse.json({ commercial: await contractCommercialHistory(gate.admin, id) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the commercial history");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { contractCharges } from "@/lib/server/amc/visit-charges";

/** A contract's visit charges (18 Nov 2026): its call outs' and additional works', for the Payments tab. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const managed = await requireManagedContract(gate, id, "read");
    if (!managed.ok) return managed.response;
    const { charges, ready } = await contractCharges(gate.admin, id);
    return NextResponse.json({ charges, ready }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the visit charges");
  }
}

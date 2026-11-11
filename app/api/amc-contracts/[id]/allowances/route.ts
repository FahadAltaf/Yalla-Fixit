import { NextRequest, NextResponse } from "next/server";

import { additionalWorkRollup } from "@/lib/server/amc/additional-works";
import { contractAllowances } from "@/lib/server/amc/call-outs";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";

/**
 * A contract's allowances (DEV-409): used, reserved and remaining per
 * service with the near-zero warning, every movement (reserve, consume,
 * release, correction), and the additional-work roll-up (DEV-407).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const managed = await requireManagedContract(gate, id, "read");
    if (!managed.ok) return managed.response;
    const [allowances, rollup] = await Promise.all([contractAllowances(gate.admin, id, await readAmcConfig(gate.admin)), additionalWorkRollup(gate.admin, [id])]);
    return NextResponse.json({ ...allowances, additionalWork: rollup }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the allowances");
  }
}

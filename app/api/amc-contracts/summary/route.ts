import { NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { contractsDashboard } from "@/lib/server/amc/contract-operations";

/**
 * The figures above the contracts list: in force, pending activation,
 * expiring, expired, the value in force, contracts with an allowance used
 * up, and recent usage. Counted from the contracts the caller can see.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({
      summary: await contractsDashboard(gate.admin, { userId: gate.userId, canApprove: gate.seesAll }),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the contract summary");
  }
}

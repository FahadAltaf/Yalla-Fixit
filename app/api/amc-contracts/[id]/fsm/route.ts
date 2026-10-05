import { NextRequest, NextResponse } from "next/server";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { contractFsmActivity } from "@/lib/server/amc/fsm-integration";

/**
 * A contract's Zoho FSM picture: integration status (customer link,
 * service mappings, linked work, automation), linked work, upcoming visits
 * and visit history. Read from the portal's own tables; it does not call
 * FSM (POST .../fsm/check does).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    return NextResponse.json({ fsm: await contractFsmActivity(gate.admin, id) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the FSM activity");
  }
}

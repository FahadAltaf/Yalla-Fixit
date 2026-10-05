import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { linkFsmCustomer } from "@/lib/server/amc/fsm-integration";

/**
 * Links the contract to its FSM customer: the FSM contact of a work order
 * the person names (by FSM id, after looking it up). Never by name.
 */
const schema = z.object({ workOrderId: z.string().trim().min(1).max(40) }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a work order" }, { status: 400 });
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const result = await linkFsmCustomer(gate.admin, id, parsed.data.workOrderId, { id: gate.userId, label: gate.label });
    return NextResponse.json({ customer: result });
  } catch (error) {
    return contractErrorResponse(error, "Could not link the FSM customer");
  }
}

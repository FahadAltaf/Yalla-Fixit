import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canLookUpFsmWorkOrder } from "@/lib/amc/access";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { loadContract } from "@/lib/server/amc/contracts";
import { lookupFsmWorkOrder } from "@/lib/server/amc/fsm-integration";

/**
 * A Zoho FSM work order by number (e.g. WO731): its contact, service lines
 * (with the FSM service id and its AMC mapping) and appointments. Used to
 * link a contract's customer and work, and to find FSM service ids.
 *
 * Not a general FSM search: approvers and AMC Operations (Edit) may look up
 * any number (service mapping, linking); anyone else only from a contract
 * they may operate (?contractId=), and only by exact number.
 */
const querySchema = z.object({
  ref: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/, "Enter a work order number"),
  contractId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Enter a work order number" }, { status: 400 });
  try {
    let ownerId: string | null = null;
    if (parsed.data.contractId) ownerId = (await loadContract(gate.admin, parsed.data.contractId)).ownerId;
    if (!canLookUpFsmWorkOrder(gate.actor, ownerId, Boolean(parsed.data.contractId))) {
      return NextResponse.json({ error: "You cannot look up FSM work orders here." }, { status: 403 });
    }
    return NextResponse.json({ workOrder: await lookupFsmWorkOrder(gate.admin, parsed.data.ref) });
  } catch (error) {
    return contractErrorResponse(error, "Could not look up the work order");
  }
}

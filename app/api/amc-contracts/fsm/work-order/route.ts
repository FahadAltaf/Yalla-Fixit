import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { lookupFsmWorkOrder } from "@/lib/server/amc/fsm-integration";

/**
 * A Zoho FSM work order by number (e.g. WO731): its contact, service lines
 * (with the FSM service id and its AMC mapping) and appointments. Used to
 * link a contract's customer and work, and to find FSM service ids.
 */
const querySchema = z.object({ ref: z.string().trim().min(2).max(40) });

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Enter a work order number" }, { status: 400 });
  try {
    return NextResponse.json({ workOrder: await lookupFsmWorkOrder(gate.admin, parsed.data.ref) });
  } catch (error) {
    return contractErrorResponse(error, "Could not look up the work order");
  }
}

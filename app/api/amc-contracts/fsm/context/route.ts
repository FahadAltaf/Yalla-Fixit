import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { fsmContextForWorkOrder } from "@/lib/server/amc/fsm-integration";

/**
 * The AMC context of a Zoho FSM work order, for scheduling: whether its
 * FSM customer has an AMC (through the explicit customer link), each
 * service line's coverage (through the explicit service mapping), and
 * whether the work is already linked. Read-only and optional: work with no
 * AMC is scheduled exactly as before.
 *
 * GET /api/amc-contracts/fsm/context?workOrderId=<FSM id or number>&date=YYYY-MM-DD
 */
const querySchema = z.object({
  workOrderId: z.string().trim().min(2).max(40),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "workOrderId is required" }, { status: 400 });
  try {
    return NextResponse.json({
      context: await fsmContextForWorkOrder(
        gate.admin,
        { userId: gate.userId, canApprove: gate.canApprove },
        parsed.data.workOrderId,
        parsed.data.date,
      ),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not check the AMC context");
  }
}

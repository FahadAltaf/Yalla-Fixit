import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { linkFsmWork } from "@/lib/server/amc/fsm-integration";

/**
 * Links FSM work (a work order, optionally one appointment and service
 * line) to one of the contract's services. Checks the FSM customer and
 * service mapping, records the coverage answer, and never consumes.
 */
const schema = z
  .object({
    workOrderId: z.string().trim().min(1).max(40),
    appointmentId: z.string().trim().max(40).nullable().optional(),
    serviceLineItemId: z.string().trim().max(40).nullable().optional(),
    entitlementId: z.string().uuid(),
    requestedAt: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "Use a date and time")
      .nullable()
      .optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const result = await linkFsmWork(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not link the FSM work");
  }
}

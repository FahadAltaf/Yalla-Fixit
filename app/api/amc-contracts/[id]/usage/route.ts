import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canManage, requireContractAccess } from "@/lib/server/amc/contract-access";
import { ContractError, loadContract, recordUsage } from "@/lib/server/amc/contracts";

/**
 * Records usage against one of the contract's services: a consumption
 * (something used) or an adjustment (a correction, with a reason). The
 * ledger is append-only and the database refuses anything that would
 * overuse an allowance or go below zero.
 */
const usageSchema = z
  .object({
    entitlementId: z.string().uuid(),
    kind: z.enum(["consumption", "adjustment"]),
    quantity: z.number().finite().min(-1000).max(1000),
    occurredAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Use a date"),
    externalType: z.enum(["fsm_work_order", "fsm_appointment", "schedule_entry"]).nullable().optional(),
    externalReference: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const parsed = usageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  try {
    const { ownerId } = await loadContract(gate.admin, id);
    if (!canManage(gate, ownerId)) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    }
    const entry = await recordUsage(gate.admin, id, parsed.data, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json({ usage: entry }, { status: 201 });
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("AMC usage failed:", error);
    return NextResponse.json({ error: "Could not record the usage" }, { status: 500 });
  }
}

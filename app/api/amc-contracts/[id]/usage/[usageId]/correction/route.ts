import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { recordCorrection } from "@/lib/server/amc/contract-operations";

/**
 * Corrects a usage entry: records a compensating entry that takes back
 * some or all of it, with a reason. The original entry is never edited or
 * deleted, and nothing can take usage below zero.
 */
const correctionSchema = z
  .object({
    /** The positive quantity to take back. */
    amount: z.number().finite().positive().max(1000),
    reason: z.string().trim().min(3, "Give a reason for the correction").max(1000),
  })
  .strict();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; usageId: string }> },
) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id, usageId } = await ctx.params;

  const parsed = correctionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(usageId)) {
    return NextResponse.json({ error: "That usage entry is not on this contract." }, { status: 404 });
  }

  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const correction = await recordCorrection(gate.admin, id, usageId, parsed.data, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json({ correction }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not record the correction");
  }
}

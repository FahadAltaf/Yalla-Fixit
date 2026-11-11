import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireContractAccess } from "@/lib/server/amc/contract-access";
import { ContractError, cancelContract } from "@/lib/server/amc/contracts";

/** Cancels an active contract. Approvers only; a reason is required. */
const cancelSchema = z
  .object({ reason: z.string().trim().min(3, "Give a reason").max(1000) })
  .strict();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.canApprove) {
    return NextResponse.json({ error: "Only an AMC approver can cancel a contract." }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = cancelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  try {
    const contract = await cancelContract(gate.admin, id, parsed.data.reason, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json({ contract });
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("AMC cancel failed:", error);
    return NextResponse.json({ error: "Could not cancel the contract" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { createAdditionalQuote } from "@/lib/server/amc/business";
import { additionalServiceSchema } from "@/lib/server/amc/business-schemas";

/**
 * Saves an additional-service quote from this contract, with its
 * eligibility and calculation as computed now. Nothing is sent; the FSM
 * estimate is created in Zoho FSM and linked afterwards.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = additionalServiceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const quote = await createAdditionalQuote(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the quote");
  }
}

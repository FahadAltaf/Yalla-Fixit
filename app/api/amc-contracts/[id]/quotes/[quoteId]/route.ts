import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { cancelQuote, linkQuoteEstimate } from "@/lib/server/amc/business";
import { UUID, quoteActionSchema } from "@/lib/server/amc/business-schemas";

/** Link the quote's Zoho FSM estimate (checked in FSM), or cancel it with a reason. The calculation never changes. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id, quoteId } = await ctx.params;
  if (!UUID.test(quoteId)) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  const parsed = quoteActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const actor = { id: gate.userId, label: gate.label };
    const quote =
      parsed.data.action === "link_estimate"
        ? await linkQuoteEstimate(gate.admin, id, quoteId, parsed.data.estimateNumber, actor)
        : await cancelQuote(gate.admin, id, quoteId, parsed.data.reason, actor);
    return NextResponse.json({ quote });
  } catch (error) {
    return contractErrorResponse(error, "Could not update the quote");
  }
}

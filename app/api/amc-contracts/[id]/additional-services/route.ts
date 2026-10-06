import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { checkAdditionalService } from "@/lib/server/amc/business";
import { additionalServiceSchema } from "@/lib/server/amc/business-schemas";

/**
 * Additional-service eligibility on this contract: in force, already
 * covered, AMC discount, and the figures. Read-only; POST .../quotes saves
 * a quote.
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
    const { eligibility } = await checkAdditionalService(gate.admin, id, parsed.data);
    return NextResponse.json({ eligibility });
  } catch (error) {
    return contractErrorResponse(error, "Could not check the service");
  }
}

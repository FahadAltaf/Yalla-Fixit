import { NextRequest, NextResponse } from "next/server";

import { renewalOutcomeSchema } from "@/lib/amc/renewal-outcomes";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { recordRenewalOutcome } from "@/lib/server/amc/renewals";

/**
 * Records a renewal's outcome by hand (DEV-416): Under negotiation, Not
 * renewed (with a reason), or Lapsed. Renewed and Renewed with revised
 * scope are set when the renewal contract starts; Lapsed also by the daily
 * job when a contract ends with nothing renewing it. Whoever operates the
 * contract.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = renewalOutcomeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const managed = await requireManagedContract(gate, id, "write");
    if (!managed.ok) return managed.response;
    return NextResponse.json(await recordRenewalOutcome(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label }));
  } catch (error) {
    return contractErrorResponse(error, "Could not record the outcome");
  }
}

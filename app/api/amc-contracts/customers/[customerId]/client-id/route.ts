import { NextRequest, NextResponse } from "next/server";

import { ensureClientRef, getCustomer } from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/**
 * Gives a client the next Client ID when it has none (a proposal prints
 * it), and returns the client. One it already has is never changed, so
 * this only ever fills a gap; FSM is only read and cannot number clients.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  try {
    await ensureClientRef(gate.admin, customerId, gate.userId);
    return NextResponse.json({ customer: await getCustomer(gate.admin, customerId) });
  } catch (error) {
    return contractErrorResponse(error, "Could not give the client an ID");
  }
}

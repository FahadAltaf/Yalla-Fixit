import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { clientToFsmOnSigning, contractFsmClientState } from "@/lib/server/amc/fsm-on-signing";

/**
 * DEV-504: is the contract's client an FSM customer yet (made on signing),
 * and "Create in FSM" when signing could not do it (an email or Maher ID
 * missing, FSM down). Reads and writes Zoho FSM only through
 * lib/server/amc/fsm-on-signing.ts.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id, "read");
    if (!contract.ok) return contract.response;
    return NextResponse.json(await contractFsmClientState(gate.admin, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not read the client's FSM state");
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id, "write");
    if (!contract.ok) return contract.response;
    /* Asked for on the page, so the answer is shown there rather than sent as a notice. */
    const result = await clientToFsmOnSigning(gate.admin, id, { id: gate.userId, label: gate.label }, { notify: false });
    if (!result.ok) return NextResponse.json({ error: result.message, state: result.state }, { status: result.state === "failed" ? 502 : 409 });
    return NextResponse.json(result);
  } catch (error) {
    return contractErrorResponse(error, "Could not put the client into Zoho FSM");
  }
}

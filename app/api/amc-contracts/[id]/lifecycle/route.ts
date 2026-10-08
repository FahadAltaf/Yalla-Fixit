import { NextRequest, NextResponse } from "next/server";

import { lifecycleActionSchema } from "@/lib/amc/contract-lifecycle";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import {
  activateSignedContract,
  changeContractStatus,
  recordSignedScan,
  signInternally,
  updateEntitlementTerms,
} from "@/lib/server/amc/contract-lifecycle";

/**
 * The contract's lifecycle actions (BRD 5.7; Phase 6):
 *
 *   sign         an internal signatory signs in the portal, in their turn
 *   scan         a signed scan (uploaded to the contract's documents) with its date
 *   activate     commencement date and term (at least the configured months) set the expiry
 *   status       on hold / resume / terminate / call off, with the reason
 *   entitlement  what a service covers besides its visits, before activation
 *
 * Signing needs only to be the signatory whose turn it is; terminating or
 * calling off needs an AMC approver; the rest, the contract's owner, an
 * approver or AMC Operations (Edit).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = lifecycleActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const body = parsed.data;
  const actor = { id: gate.userId, label: gate.label };

  try {
    if (body.action === "sign") {
      return NextResponse.json(await signInternally(gate.admin, id, actor, body.typedName));
    }
    const managed = await requireManagedContract(gate, id, "write");
    if (!managed.ok) return managed.response;
    switch (body.action) {
      case "scan":
        return NextResponse.json(await recordSignedScan(gate.admin, id, body, actor));
      case "activate":
        /* Starting before the first payment is an authorised override (BRD 6.7, DEV-386). */
        if (body.startWithoutPayment && !gate.payments.approve) {
          return NextResponse.json({ error: "Only someone with AMC Payments (Approve) can start a contract before its first payment." }, { status: 403 });
        }
        return NextResponse.json(await activateSignedContract(gate.admin, id, body, actor, await readAmcConfig(gate.admin)));
      case "entitlement":
        await updateEntitlementTerms(gate.admin, id, body, actor);
        return NextResponse.json({ ok: true });
      case "status":
        if ((body.to === "terminated" || body.to === "cancelled") && !gate.canApprove) {
          return NextResponse.json({ error: "Only an AMC approver can terminate or call off a contract." }, { status: 403 });
        }
        return NextResponse.json(await changeContractStatus(gate.admin, id, body, actor));
    }
  } catch (error) {
    return contractErrorResponse(error, "Could not update the contract");
  }
}

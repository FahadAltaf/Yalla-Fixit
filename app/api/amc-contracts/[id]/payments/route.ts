import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { paymentActionSchema, rightFor } from "@/lib/amc/payments";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { contractPayments, performPaymentAction } from "@/lib/server/amc/payments";

/**
 * A contract's payments (BRD 5.8; Phase 7): the schedule, receipts and
 * cheques, and every action on them.
 *
 *   read        the contract's owner, anyone who may read the contract, Finance (AMC Payments View)
 *   record      cash / transfer / link / cheque received, deposit, clear, hand over, remind:
 *               the owner or AMC Payments (Create or Edit)
 *   correct     bounce, replace, return, void, make a missing schedule: AMC Payments (Edit)
 *   authorise   write off, waive, start before the first payment: AMC Payments (Approve)
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const loaded = await requireManagedContract(gate, id, "read");
    if (!loaded.ok) return loaded.response;
    const owner = canOperateContract(gate.actor, loaded.ownerId);
    return NextResponse.json({
      ...(await contractPayments(gate.admin, id)),
      permissions: {
        canRecord: gate.payments.create || gate.payments.edit || owner,
        canEdit: gate.payments.edit,
        canApprove: gate.payments.approve,
      },
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the payments");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = paymentActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const loaded = await requireManagedContract(gate, id, "read");
    if (!loaded.ok) return loaded.response;
    const owner = canOperateContract(gate.actor, loaded.ownerId);
    const right = rightFor(parsed.data.action);
    const allowed =
      right === "approve" ? gate.payments.approve : right === "edit" ? gate.payments.edit : gate.payments.create || gate.payments.edit || owner;
    if (!allowed) {
      const who =
        right === "approve"
          ? "someone with AMC Payments (Approve)"
          : right === "edit"
            ? "Finance (AMC Payments, Edit)"
            : "the contract's owner or Finance";
      return NextResponse.json({ error: `Only ${who} can do that.` }, { status: 403 });
    }
    const result = await performPaymentAction(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin));
    return NextResponse.json(result);
  } catch (error) {
    return contractErrorResponse(error, "Could not record that");
  }
}

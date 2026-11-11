import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { amendmentActionSchema } from "@/lib/amc/amendments";
import { performAmendmentAction } from "@/lib/server/amc/amendments";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";

/**
 * One amendment: approve / reject (an AMC approver who is not the
 * requester), apply (once approved; whoever operates the contract, or an
 * approver), withdraw (the requester or an approver).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; amendmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id, amendmentId } = await ctx.params;
  if (!UUID.test(amendmentId)) return NextResponse.json({ error: "Amendment not found." }, { status: 404 });
  const parsed = amendmentActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const managed = await requireManagedContract(gate, id, "read");
    if (!managed.ok) return managed.response;
    return NextResponse.json(
      await performAmendmentAction(
        gate.admin,
        id,
        amendmentId,
        parsed.data,
        { id: gate.userId, label: gate.label },
        { canApprove: gate.canApprove, canOperate: canOperateContract(gate.actor, managed.ownerId) },
        await readAmcConfig(gate.admin),
      ),
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not update the amendment");
  }
}

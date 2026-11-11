import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { amendmentRequestSchema } from "@/lib/amc/amendments";
import { listAmendments, requestAmendment } from "@/lib/server/amc/amendments";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";

/**
 * A contract's amendments (DEV-417).
 *
 *   GET    the requests, newest first, and what the caller may do
 *   POST   ask for one (whoever operates the contract); an AMC approver who
 *          is not the requester decides it
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const managed = await requireManagedContract(gate, id, "read");
    if (!managed.ok) return managed.response;
    return NextResponse.json(
      { ...(await listAmendments(gate.admin, id)), canRequest: canOperateContract(gate.actor, managed.ownerId), canApprove: gate.canApprove, userId: gate.userId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the amendments");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = amendmentRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const managed = await requireManagedContract(gate, id, "write");
    if (!managed.ok) return managed.response;
    return NextResponse.json(await requestAmendment(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin)), { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not ask for the amendment");
  }
}

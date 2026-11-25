import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { amendmentRequestSchema } from "@/lib/amc/amendments";
import { amendmentDeciders, listAmendments, requestAmendment, scheduledEnding } from "@/lib/server/amc/amendments";
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
    const listed = await listAmendments(gate.admin, id);
    /* Who decides each waiting request (24 Nov 2026), so nobody waits on a button they will never get. */
    const waiting = listed.amendments.filter((a) => a.status === "requested");
    const config = waiting.length ? await readAmcConfig(gate.admin) : null;
    const amendments = config
      ? await Promise.all(
          listed.amendments.map(async (a) => (a.status === "requested" ? { ...a, deciders: (await amendmentDeciders(gate.admin, config, a.requestedBy)).names } : a)),
        )
      : listed.amendments;
    return NextResponse.json(
      {
        ...listed,
        amendments,
        /* Ending on a set day (24 Nov 2026): nothing more is asked for. */
        canRequest: canOperateContract(gate.actor, managed.ownerId) && !(await scheduledEnding(gate.admin, id)),
        canApprove: gate.canApprove,
        userId: gate.userId,
      },
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

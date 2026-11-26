import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { amendmentRequestSchema } from "@/lib/amc/amendments";
import { amendmentDeciders, listAmendments, requestAmendment, requestAndApplyAmendment, scheduledEnding } from "@/lib/server/amc/amendments";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";

/**
 * A contract's amendments (DEV-417).
 *
 *   GET    the requests, newest first, and what the caller may do
 *   POST   ask for one (whoever operates the contract); one AMC approver
 *          decides it. With `decideNow`, an AMC approver asks, approves and
 *          applies it in one step (DEV-417, 26 Nov 2026: one approver is enough).
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
  const raw = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const { decideNow, validReason, ...request } = raw;
  const parsed = amendmentRequestSchema.safeParse(request);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const managed = await requireManagedContract(gate, id, "write");
    if (!managed.ok) return managed.response;
    const actor = { id: gate.userId, label: gate.label };
    const config = await readAmcConfig(gate.admin);
    if (decideNow === true) {
      if (!gate.canApprove) return NextResponse.json({ error: "Only an AMC approver can do this in one step; ask for it instead." }, { status: 403 });
      return NextResponse.json(await requestAndApplyAmendment(gate.admin, id, parsed.data, actor, config, { validReason: validReason === true }), { status: 201 });
    }
    return NextResponse.json(await requestAmendment(gate.admin, id, parsed.data, actor, config), { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not ask for the amendment");
  }
}

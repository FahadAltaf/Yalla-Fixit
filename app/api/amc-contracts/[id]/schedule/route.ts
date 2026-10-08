import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { ppmActionSchema } from "@/lib/amc/ppm";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { contractPpm, performPpmAction } from "@/lib/server/amc/ppm";

/**
 * A contract's PPM schedule (BRD 5.10; Phase 8): the visits with their
 * service windows, the change history, and completed / remaining /
 * overdue. Anyone who may read the contract sees it; the contract's owner,
 * an approver or AMC Operations (Edit) changes it -- generate, move, add,
 * remove, club, separate, confirm, and the window and attempt rule.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const loaded = await requireManagedContract(gate, id, "read");
    if (!loaded.ok) return loaded.response;
    const config = await readAmcConfig(gate.admin);
    return NextResponse.json({
      ...(await contractPpm(gate.admin, id, config)),
      permissions: { canEdit: canOperateContract(gate.actor, loaded.ownerId) },
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the schedule");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = ppmActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const managed = await requireManagedContract(gate, id, "write");
    if (!managed.ok) return managed.response;
    const result = await performPpmAction(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin));
    return NextResponse.json(result);
  } catch (error) {
    return contractErrorResponse(error, "Could not change the schedule");
  }
}

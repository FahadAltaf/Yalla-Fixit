import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { unlinkFsmWork } from "@/lib/server/amc/fsm-integration";

/**
 * Unlinks FSM work from the contract, with a reason. The link row is kept
 * (marked unlinked); usage already recorded is untouched and is corrected
 * separately if it should not count.
 */
const schema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) }).strict();

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id, linkId } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Give a reason" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) return NextResponse.json({ error: "Link not found." }, { status: 404 });
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    await unlinkFsmWork(gate.admin, id, linkId, parsed.data.reason, { id: gate.userId, label: gate.label });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not unlink the FSM work");
  }
}

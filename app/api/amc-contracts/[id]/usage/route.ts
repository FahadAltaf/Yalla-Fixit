import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { recordUsage } from "@/lib/server/amc/contracts";
import { canCorrectUsage } from "@/lib/amc/access";
import { loadUsagePage } from "@/lib/server/amc/contract-operations";
import { pageParams } from "@/lib/server/snagging/search";

/**
 * A contract's usage ledger. GET lists it, newest first, a page at a time.
 * POST records a consumption: something used against one of the services.
 *
 * The ledger is append-only: entries are never edited or deleted. A
 * mistake is put right with a correction (POST .../usage/<id>/correction),
 * which references the entry, carries a reason and cannot take usage below
 * zero. The database refuses anything that would overuse an allowance.
 */
const usageSchema = z
  .object({
    entitlementId: z.string().uuid(),
    kind: z.literal("consumption"),
    quantity: z.number().finite().positive().max(1000),
    occurredAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Use a date"),
    externalType: z.enum(["fsm_work_order", "fsm_appointment", "schedule_entry"]).nullable().optional(),
    externalReference: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const params = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(params, { defaultSize: 10 });
  const entitlementId = params.get("entitlementId");
  try {
    const contract = await requireManagedContract(gate, id, "read");
    if (!contract.ok) return contract.response;
    const result = await loadUsagePage(gate.admin, id, {
      page,
      pageSize,
      entitlementId: entitlementId && /^[0-9a-f-]{36}$/i.test(entitlementId) ? entitlementId : null,
    });
    return NextResponse.json({ ...result, page, pageSize });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the usage history");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const parsed = usageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    /* DEV-499: usage typed in by hand, with no FSM reference behind it, is a correction of the balance:
       the correction right (an approver, AMC Operations Approve, AMC Allowances Approve) and a reason. */
    if (!parsed.data.externalReference?.trim()) {
      if (!canCorrectUsage(gate.actor, contract.ownerId)) {
        return NextResponse.json({ error: "Usage without an FSM reference is a manual correction: it needs the correction right (an AMC approver)." }, { status: 403 });
      }
      if ((parsed.data.notes ?? "").trim().length < 3) {
        return NextResponse.json({ error: "Say why this usage is recorded by hand (Notes)." }, { status: 400 });
      }
    }
    const entry = await recordUsage(gate.admin, id, parsed.data, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json({ usage: entry }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not record the usage");
  }
}

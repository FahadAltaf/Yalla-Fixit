import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { EVIDENCE_MAX_FILES, workOrderEvidencePrefix } from "@/lib/finance/evidence";
import { notifyExclusionRequested } from "@/lib/server/finance/queue-notifications";
import { actorOf } from "@/lib/server/finance/route-helpers";
import { InvoicingError, requestWorkOrderExclusion } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The coordinator marks a work order not to be invoiced (BRD 5.1 Step 5;
 * TC05), with a reason and evidence files uploaded through ./evidence. It
 * is not Excluded until verified; N3 goes to whoever may verify.
 *
 * Body: { reason, notes?, evidence?: string[] }
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;
const bodySchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullish(),
    evidence: z.array(z.string().trim().min(1).max(500)).max(EVIDENCE_MAX_FILES).optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
  if (!gate.ok) return gate.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  if (parsed.data.evidence?.some((path) => !path.startsWith(workOrderEvidencePrefix(id)) || path.includes(".."))) {
    return NextResponse.json({ error: "Evidence must be uploaded to this work order" }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(gate.access.profile);
    const result = await requestWorkOrderExclusion(admin, id, parsed.data, actor);
    await notifyExclusionRequested(admin, {
      exclusionId: result.exclusionId,
      itemId: id,
      workOrderNumber: result.workOrderNumber ?? "a work order",
      value: result.value,
      reason: parsed.data.reason,
      coordinator: actor.label,
    });
    return NextResponse.json({ exclusionId: result.exclusionId });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice exclusion error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

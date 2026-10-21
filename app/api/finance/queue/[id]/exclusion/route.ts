import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readQueueItemSummary, requestExclusion } from "@/lib/server/finance/queue";
import { notifyExclusionRequested } from "@/lib/server/finance/queue-notifications";
import { UUID_PATTERN, actorOf, queueErrorResponse } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The coordinator marks an item as not to be invoiced (BRD §5.1 Step 5;
 * TC05). It is not Excluded until verified; N3 goes to whoever may verify.
 *
 * Body: { reason, notes?, evidence? } where evidence is storage paths of
 * files already uploaded (the upload comes with the item screen, P4).
 */

const bodySchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullish(),
    evidence: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(gate.access.profile);
    const exclusionId = await requestExclusion(admin, { itemId: id, ...parsed.data, actor });
    const item = await readQueueItemSummary(admin, id);
    await notifyExclusionRequested(admin, {
      exclusionId,
      itemId: id,
      workOrderNumber: item.workOrderNumber,
      value: item.value,
      reason: parsed.data.reason,
      coordinator: actor.label,
    });
    return NextResponse.json({ exclusionId });
  } catch (error) {
    return queueErrorResponse(error, "Finance exclusion request error");
  }
}

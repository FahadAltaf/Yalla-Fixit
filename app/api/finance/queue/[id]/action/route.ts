import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { QUEUE_ACTIONS, QUEUE_STATUSES, applyQueueAction, readQueueItemSummary } from "@/lib/server/finance/queue";
import { notifyQueryRaised, resolveAgedNotices, resolveQueryNotices } from "@/lib/server/finance/queue-notifications";
import { UUID_PATTERN, actorOf, queueErrorResponse } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Finance works an item through its statuses (BRD §5.1 Step 4).
 *
 * Body: { action, expectedStatus, note? }. `expectedStatus` is the status
 * the person saw; if someone has moved the item since, nothing changes and
 * the answer is 409.
 *
 * Who: Finance (queue Edit) for every action except answering a query,
 * which is the coordinator's (the role that requests exclusions; D-18 maps
 * the role names).
 */

const bodySchema = z
  .object({
    action: z.enum(QUEUE_ACTIONS as [string, ...string[]]),
    expectedStatus: z.enum(QUEUE_STATUSES as [string, ...string[]]),
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, expectedStatus, note } = parsed.data;

  const gate =
    action === "answer_query"
      ? await requireResourceAccess(ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE)
      : await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.EDIT);
  if (!gate.ok) return gate.response;

  try {
    const admin = await createAdminServerClient();
    const status = await applyQueueAction(admin, {
      itemId: id,
      action: action as Parameters<typeof applyQueueAction>[1]["action"],
      expected: expectedStatus as Parameters<typeof applyQueueAction>[1]["expected"],
      actor: actorOf(gate.access.profile),
      note,
    });

    if (action === "raise_query") {
      const item = await readQueueItemSummary(admin, id);
      await notifyQueryRaised(admin, {
        itemId: id,
        workOrderNumber: item.workOrderNumber,
        question: note ?? "",
        raisedAt: item.statusChangedAt,
      });
    } else if (action === "answer_query") {
      await resolveQueryNotices(admin, id);
    }
    await resolveAgedNotices(admin, id);
    return NextResponse.json({ status });
  } catch (error) {
    return queueErrorResponse(error, "Finance queue action error");
  }
}

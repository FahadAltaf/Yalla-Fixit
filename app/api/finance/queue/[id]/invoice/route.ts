import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordInvoice } from "@/lib/server/finance/queue";
import { resolveQueryNotices } from "@/lib/server/finance/queue-notifications";
import { UUID_PATTERN, actorOf, queueErrorResponse } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Finance records the MAHER invoice (BRD §5.1 Step 7; TC06).
 *
 * Body: { idempotencyKey, number, date, amount, varianceReason? }. The key
 * is made once by the form; a double click or a retry after a timeout sends
 * the same key and gets the first invoice back, never a second one.
 *
 * Who: queue Approve ("record invoice"), which an administrator holds only
 * when granted it (NOT_INHERITED_BY_ADMIN).
 */

const bodySchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(100),
    number: z.string().trim().min(1).max(60),
    date: z.iso.date(),
    amount: z.number().min(0).max(100_000_000).multipleOf(0.01),
    varianceReason: z.string().trim().max(1000).nullish(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.APPROVE);
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid invoice details" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const invoiceId = await recordInvoice(admin, { itemId: id, ...parsed.data, actor: actorOf(gate.access.profile) });
    /* An invoiced item has no open query left to answer. */
    await resolveQueryNotices(admin, id);
    return NextResponse.json({ invoiceId, status: "invoiced" });
  } catch (error) {
    return queueErrorResponse(error, "Finance record invoice error");
  }
}

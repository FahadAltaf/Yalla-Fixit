import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveAgedNotices, resolveExclusionNotices } from "@/lib/server/finance/queue-notifications";
import { UUID_PATTERN, actorOf } from "@/lib/server/finance/route-helpers";
import { decideWorkOrderExclusion, InvoicingError } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Behrouz verifies or rejects a work order's not-invoiceable request (BRD
 * 5.1 Step 5): verified makes it Excluded; rejected leaves it where it was,
 * with the note. N3 closes for everyone it went to.
 *
 * Who: Not-invoiceable Approve (not inherited by administrators).
 */
const bodySchema = z.object({ decision: z.enum(["verified", "rejected"]), note: z.string().trim().max(2000).nullish() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ exclusionId: string }> }) {
  const { exclusionId } = await ctx.params;
  if (!UUID_PATTERN.test(exclusionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE);
  if (!gate.ok) return gate.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const result = await decideWorkOrderExclusion(admin, exclusionId, parsed.data, actorOf(gate.access.profile));
    /* Closing N3 and the aged notices after the answer is sent (27 Oct). */
    after(async () => {
      try {
        await resolveExclusionNotices(admin, exclusionId);
        if (result.workOrderId) await resolveAgedNotices(admin, result.workOrderId);
      } catch (error) {
        console.error("Exclusion decision notices:", error);
      }
    });
    return NextResponse.json({ status: result.status });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice exclusion decision error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

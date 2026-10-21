import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { decideExclusion } from "@/lib/server/finance/queue";
import { resolveExclusionNotices } from "@/lib/server/finance/queue-notifications";
import { UUID_PATTERN, actorOf, queueErrorResponse } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Behrouz verifies or rejects a not-invoiceable request (BRD §5.1 Step 5,
 * §6.8): verified makes the item Excluded; rejected returns it to Pending
 * with the note. Either way, N3 closes for everyone it went to.
 *
 * Who: exclusions Approve, which an administrator holds only when granted
 * it (NOT_INHERITED_BY_ADMIN).
 */

const bodySchema = z
  .object({
    decision: z.enum(["verified", "rejected"]),
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE);
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const status = await decideExclusion(admin, {
      exclusionId: id,
      decision: parsed.data.decision,
      note: parsed.data.note,
      actor: actorOf(gate.access.profile),
    });
    await resolveExclusionNotices(admin, id);
    return NextResponse.json({ status });
  } catch (error) {
    return queueErrorResponse(error, "Finance exclusion decision error");
  }
}

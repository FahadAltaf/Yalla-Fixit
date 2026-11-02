import { after, NextRequest, NextResponse } from "next/server";

import { sideOf } from "@/lib/server/finance/queries";
import { notifyWorkOrderChange, resolveAgedNotices } from "@/lib/server/finance/queue-notifications";
import { actorOf, querySides, workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { actionRequestSchema, applyWorkOrderAction, InvoicingError } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * A work order's workflow (BRD 5.1 Step 4): put on hold, resume. Either
 * team does both (route-helpers), and the other team is told who did it
 * (2 Nov). `expectedStatus` is the workflow status the person saw: if it
 * has moved on, nothing changes.
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const parsed = actionRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!workOrderAbilities(gate.access.accessUser).hold) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const side = sideOf(querySides(gate.access.accessUser), parsed.data.as);

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(gate.access.profile);
    const result = await applyWorkOrderAction(admin, id, parsed.data, actor);
    /* Notices after the answer is sent (27 Oct): the person does not wait on them. */
    after(async () => {
      await resolveAgedNotices(admin, id).catch((error) => console.error("Ready to invoice action notices:", error));
      if (side) {
        await notifyWorkOrderChange(admin, {
          workOrderId: id,
          workOrderNumber: result.workOrderNumber,
          change: parsed.data.action === "put_on_hold" ? "on_hold" : "resumed",
          side,
          author: actor,
          reason: parsed.data.note?.trim() || null,
        });
      }
    });
    return NextResponse.json({ status: result.status });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice action error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

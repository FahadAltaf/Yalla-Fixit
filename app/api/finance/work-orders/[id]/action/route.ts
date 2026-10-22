import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { notifyQueryRaised, resolveAgedNotices, resolveQueryNotices } from "@/lib/server/finance/queue-notifications";
import { actorOf } from "@/lib/server/finance/route-helpers";
import { actionRequestSchema, applyWorkOrderAction, InvoicingError } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Finance works a work order (BRD 5.1 Step 4): pick up, release, raise a
 * query (N4 to the coordinators), put on hold, resume; the coordinator
 * answers a query. `expectedStatus` is the workflow status the person saw:
 * if it has moved on, nothing changes.
 *
 * Who: Finance (queue Edit) for every action except answering a query,
 * which a coordinator does (Not-invoiceable Create).
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const parsed = actionRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const allowed =
    parsed.data.action === "answer_query"
      ? hasResourceAction(gate.access.accessUser, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE)
      : hasResourceAction(gate.access.accessUser, ResourceType.FINANCE_QUEUE, ActionType.EDIT);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admin = await createAdminServerClient();
    const result = await applyWorkOrderAction(admin, id, parsed.data, actorOf(gate.access.profile));
    if (parsed.data.action === "raise_query") {
      await notifyQueryRaised(admin, {
        itemId: id,
        workOrderNumber: result.workOrderNumber ?? "a work order",
        question: parsed.data.note ?? "",
        raisedAt: new Date().toISOString(),
      });
    } else if (parsed.data.action === "answer_query") {
      await resolveQueryNotices(admin, id);
    }
    await resolveAgedNotices(admin, id);
    return NextResponse.json({ status: result.status });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice action error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

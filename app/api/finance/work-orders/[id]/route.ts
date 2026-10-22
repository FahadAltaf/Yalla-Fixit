import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { FsmLiveError } from "@/lib/server/finance/fsm-live";
import { readWorkOrderDetail } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * One work order for Ready to invoice, read live from Zoho FSM: header,
 * line items and quotation (one or two calls, or none within ten minutes
 * of the last read; ?refresh=1 reads again), with the portal's Ready
 * marks, invoices, workflow and history. Answers { data } with what the
 * caller may do.
 */

export const dynamic = "force-dynamic";

const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  const can = {
    view: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW),
    work: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.EDIT),
    invoice: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.APPROVE),
    coordinate: hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE),
    verify: hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE),
  };
  if (!can.view && !can.coordinate && !can.verify) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admin = await createAdminServerClient();
    const detail = await readWorkOrderDetail(admin, id, { refresh: req.nextUrl.searchParams.get("refresh") === "1" });
    if (!detail) return NextResponse.json({ error: "No such work order in Zoho FSM" }, { status: 404 });
    return NextResponse.json(
      { data: { ...detail, can: { ...can, markReady: can.work || can.coordinate } } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof FsmLiveError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice work order error:", error);
    return NextResponse.json({ error: "Could not load this work order" }, { status: 500 });
  }
}

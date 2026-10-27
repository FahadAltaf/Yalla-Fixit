import { NextRequest, NextResponse } from "next/server";

import { FsmLiveError } from "@/lib/server/finance/fsm-live";
import { workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { readWorkOrderDetail } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

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
  /* What this person's team may do here (Finance or Operations, route-helpers). */
  const can = workOrderAbilities(gate.access.accessUser);
  if (!can.view && !can.verify) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admin = await createAdminServerClient();
    const detail = await readWorkOrderDetail(admin, id, { refresh: req.nextUrl.searchParams.get("refresh") === "1" });
    if (!detail) return NextResponse.json({ error: "No such work order in Zoho FSM" }, { status: 404 });
    return NextResponse.json(
      { data: { ...detail, can } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof FsmLiveError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice work order error:", error);
    return NextResponse.json({ error: "Could not load this work order" }, { status: 500 });
  }
}

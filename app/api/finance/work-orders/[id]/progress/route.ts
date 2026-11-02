import { NextRequest, NextResponse } from "next/server";

import { syncCompletionToFsm } from "@/lib/server/finance/fsm-completion";
import { recordFsmCompletion } from "@/lib/server/finance/fsm-completion-log";
import { actorOf, workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { InvoicingError, progressRequestSchema, recordProgress } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Operations records how far work has got (26 Oct, changes 4 and 5):
 * "X % done" against the whole work order or some of its lines, either to
 * invoice or for revenue only. It fills Finance's side; it never records an
 * invoice. A line or the whole work order marked complete (100 %) is then
 * completed in Zoho FSM too (2 Nov, lib/server/finance/fsm-completion.ts,
 * behind FINANCE_FSM_COMPLETION=on); whatever FSM says, the portal's entry
 * stays saved, and FSM's answer comes back as `fsm` and goes on the history.
 *
 * Who: Operations only (27 Oct, route-helpers), also for Mark ready to invoice
 * (100% done to invoice).
 * Body: { entries: [{ line | null, percent, purpose }], note? }.
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  if (!workOrderAbilities(gate.access.accessUser).progress) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = progressRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(gate.access.profile);
    const result = await recordProgress(admin, id, parsed.data, actor);
    const changedLines = parsed.data.entries.filter((e) => e.line !== null && e.percent >= 100).map((e) => e.line as string);
    const wholeWorkOrder = parsed.data.entries.some((e) => e.line === null && e.percent >= 100);
    if (!changedLines.length && !wholeWorkOrder) return NextResponse.json({ data: { recorded: result.recorded, fsm: null } });
    const fsm = await syncCompletionToFsm(admin, {
      workOrderId: id,
      workOrderNumber: result.workOrderNumber,
      completeLines: result.completeLines,
      changedLines,
      wholeWorkOrder,
    });
    if (fsm.state !== "off") await recordFsmCompletion(admin, { workOrderId: id, workOrderNumber: result.workOrderNumber, result: fsm, actor });
    return NextResponse.json({ data: { recorded: result.recorded, fsm } });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Record progress error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

import { after, NextRequest, NextResponse } from "next/server";

import { notifyQueryRaised, resolveAgedNotices, resolveQueryNotices } from "@/lib/server/finance/queue-notifications";
import { actorOf, workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { actionRequestSchema, applyWorkOrderAction, InvoicingError } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Finance works a work order (BRD 5.1 Step 4): pick up, release, raise a
 * query (N4 to the coordinators), put on hold, resume; the coordinator
 * answers a query. `expectedStatus` is the workflow status the person saw:
 * if it has moved on, nothing changes.
 *
 * Who (27 Oct, route-helpers): Finance raises a query; Operations answers
 * it; either team puts on hold and resumes.
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const parsed = actionRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const can = workOrderAbilities(gate.access.accessUser);
  const allowed =
    parsed.data.action === "raise_query" ? can.query : parsed.data.action === "answer_query" ? can.answer : can.hold;
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admin = await createAdminServerClient();
    const result = await applyWorkOrderAction(admin, id, parsed.data, actorOf(gate.access.profile));
    /* Notices and emails after the answer is sent (27 Oct): the person does not wait on them. */
    after(async () => {
      try {
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
      } catch (error) {
        console.error("Ready to invoice action notices:", error);
      }
    });
    return NextResponse.json({ status: result.status });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice action error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

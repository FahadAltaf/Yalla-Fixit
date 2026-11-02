import { after, NextRequest, NextResponse } from "next/server";

import { notifyQueryOpened, resolveAgedNotices } from "@/lib/server/finance/queue-notifications";
import { listQueryThreads, openQuerySchema, openQueryThread, queryFiltersSchema, sideOf, tagOptions } from "@/lib/server/finance/queries";
import { actorOf, querySides, workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { InvoicingError } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Queries (2 Nov): comment threads between Finance and Operations on work
 * orders (lib/server/finance/queries.ts). From the portal's records only:
 * no FSM call to list.
 *
 * GET  query: view (waiting | open | resolved | all), raisedBy, kind,
 *      workOrder, page, pageSize. Answers { data: { rows, total, counts,
 *      ready, sides, tagOptions } }: the sides the viewer acts for, and the
 *      people of the other side they may tag.
 * POST { workOrderId, kind, body, lineIds?, taggedUserId?, as? }: raise a
 *      query. Finance asks a question or says not invoiceable; Operations
 *      asks a question. Answers { id }.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  if (!workOrderAbilities(gate.access.accessUser).view) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sides = querySides(gate.access.accessUser);
  const filters = queryFiltersSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    const [result, finance, operations] = await Promise.all([
      listQueryThreads(admin, filters.data, sides),
      sides.includes("operations") ? tagOptions(admin, "finance") : Promise.resolve([]),
      sides.includes("finance") ? tagOptions(admin, "operations") : Promise.resolve([]),
    ]);
    return NextResponse.json({ data: { ...result, sides, tagOptions: { finance, operations } } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Finance queries error:", error);
    return NextResponse.json({ error: "Could not load the queries" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const parsed = openQuerySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write the query" }, { status: 400 });
  const side = sideOf(querySides(gate.access.accessUser), parsed.data.as);
  if (!side) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(gate.access.profile);
    const result = await openQueryThread(admin, parsed.data, side, actor);
    /* Notices after the answer is sent: the person does not wait on them. */
    after(async () => {
      await notifyQueryOpened(admin, {
        threadId: result.id,
        workOrderId: parsed.data.workOrderId,
        workOrderNumber: result.workOrderNumber,
        kind: parsed.data.kind,
        side,
        author: actor,
        body: parsed.data.body,
        taggedUserId: result.tagged?.id ?? null,
      });
      await resolveAgedNotices(admin, parsed.data.workOrderId);
    });
    return NextResponse.json({ id: result.id });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Raise query error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

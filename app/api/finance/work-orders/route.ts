import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { FsmLiveError } from "@/lib/server/finance/fsm-live";
import { listWorkOrders, workOrderFiltersSchema } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Ready to invoice (BRD 5.1, 6.4): FSM's work orders raised in the chosen
 * dates (default the last 30 days, at most four months back), read live
 * from Zoho FSM, with the portal's Ready marks, invoices and workflow. A
 * call or two to FSM, or none within ten minutes of the last read for the
 * same dates; ?refresh=1 reads again.
 *
 * Query: from, to, q, client, coordinator, status (open | all | a queue
 * status), aged=1, refresh=1, page, pageSize. Answers { data }.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (
    !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = workOrderFiltersSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const can = { invoice: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.APPROVE) };
    return NextResponse.json({ data: { ...(await listWorkOrders(admin, parsed.data)), can } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FsmLiveError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice list error:", error);
    return NextResponse.json({ error: "Could not load the work orders" }, { status: 500 });
  }
}

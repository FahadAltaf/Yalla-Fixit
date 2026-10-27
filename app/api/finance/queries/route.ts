import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { listFinanceRequests, requestFiltersSchema } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The query dashboard (26 Oct, change 9; 27 Oct): every query Finance has
 * raised and every request to mark a work order not invoiceable, waiting or
 * done (answered, verified, rejected), paged here. From the portal's
 * records only: no FSM call.
 *
 * Query: status (waiting | done | all), kind (all | query | exclusion), page, pageSize.
 * Answers { data: { rows, total, counts, ledgerReady, canAnswer, canVerify } }.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  const canAnswer = hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
  const canVerify = hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE);
  if (!canAnswer && !canVerify && !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const admin = await createAdminServerClient();
    const filters = requestFiltersSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!filters.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    const result = await listFinanceRequests(admin, filters.data);
    return NextResponse.json({ data: { ...result, canAnswer, canVerify } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Finance queries error:", error);
    return NextResponse.json({ error: "Could not load the queries" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { listWorkOrders, workOrderFiltersSchema } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Work orders for invoicing, from the portal's copy of FSM: the chosen
 * dates (default the last 30 days, at most four months back), with each
 * work order's quotation and, once it has been opened, its line items.
 * Reading this costs no FSM calls; POST ./refresh brings the copy up to date.
 *
 * Query: from, to (YYYY-MM-DD), q, client, status, page, pageSize.
 * Answers { data } (the shape the section cache reads).
 */

export const dynamic = "force-dynamic";

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
    console.error("Finance work orders error:", error);
    return NextResponse.json({ error: "Could not load the work orders" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { readWorkOrderDetail } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * One work order for invoicing: header, quotation, line items and the
 * appointments that delivered it. Its lines are read from FSM (one call)
 * only when the copy is older than the work order's last change, or with
 * ?refresh=1; otherwise this costs no FSM call.
 */

export const dynamic = "force-dynamic";

const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (
    !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = await createAdminServerClient();
    const detail = await readWorkOrderDetail(admin, id, { refresh: req.nextUrl.searchParams.get("refresh") === "1" });
    if (!detail) return NextResponse.json({ error: "No such work order" }, { status: 404 });
    const can = {
      markReady:
        hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.EDIT) ||
        hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE),
      invoice: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.APPROVE),
    };
    return NextResponse.json({ data: { ...detail, can } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Finance work order error:", error);
    return NextResponse.json({ error: "Could not load this work order" }, { status: 500 });
  }
}

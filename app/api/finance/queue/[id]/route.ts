import { NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { readQueueItem } from "@/lib/server/finance/queue-read";
import { UUID_PATTERN, queueErrorResponse } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * One queue item (BRD §5.1 Step 3, §6.4; DEV-436), and what the caller may
 * do with it. Finance opens it from the queue; a coordinator or Behrouz
 * opens it from N4 or N3, so their permissions also let them read it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  const can = {
    view: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW),
    work: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.EDIT),
    recordInvoice: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.APPROVE),
    coordinate: hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE),
    verify: hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE),
  };
  if (!can.view && !can.coordinate && !can.verify) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = await createAdminServerClient();
    return NextResponse.json({ ...(await readQueueItem(admin, id)), can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return queueErrorResponse(error, "Finance queue item error");
  }
}

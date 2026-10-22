import { NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { FsmUnavailableError, refreshWorkOrderHeaders } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Refresh: what changed in FSM since the last sync, as headers only (work
 * orders, quotations, appointments): a page or two of read calls, never
 * one per work order. Pressed again within a minute it does nothing.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
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
    return NextResponse.json({ data: await refreshWorkOrderHeaders(admin) });
  } catch (error) {
    if (error instanceof FsmUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Finance work orders refresh error:", error);
    return NextResponse.json({ error: "Zoho FSM could not be read. The last copy is still shown." }, { status: 502 });
  }
}

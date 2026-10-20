import { NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { readFsmSyncStatus } from "@/lib/server/finance/fsm-sync/status";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * How fresh the FSM copy is (P2): per resource, the last successful sync,
 * the last error and the backfill's progress. Shown beside every report and
 * the invoicing queue, so anyone who can open one of them may read it.
 */

const READERS = [
  ResourceType.FINANCE_QUEUE,
  ResourceType.REPORTS_QUOTATIONS,
  ResourceType.REPORTS_UTILIZATION,
  ResourceType.REPORTS_CAPACITY,
  ResourceType.REPORTS_ATTENDANCE,
  ResourceType.REPORTS_REVENUE,
  ResourceType.REPORTS_EXCEPTIONS,
  ResourceType.REPORTING_SETTINGS,
];

export async function GET() {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (!READERS.some((resource) => hasResourceAction(user, resource, ActionType.VIEW))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await readFsmSyncStatus(admin), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FSM sync status error:", error);
    return NextResponse.json({ error: "Could not load FSM sync status" }, { status: 500 });
  }
}

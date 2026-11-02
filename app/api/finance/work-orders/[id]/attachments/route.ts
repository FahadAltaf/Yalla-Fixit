import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { fetchAttachmentsLive, fetchServiceReportsLive, fetchWorkOrderLive, FsmLiveError } from "@/lib/server/finance/fsm-live";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The service reports (FSM's Service Reports module, one per appointment:
 * the client-signed proof of completion) and the files on a work order and
 * its appointments, read from Zoho FSM when the Reports tab opens (26 Oct,
 * change 8). A call for the work order and two per appointment, kept ten
 * minutes; ?refresh=1 reads again.
 */

export const dynamic = "force-dynamic";
/* A first read of Zoho FSM for the dates can take half a minute (26 Oct: the reports read FSM live). */
export const maxDuration = 60;

const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (
    !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = await createAdminServerClient();
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const live = await fetchWorkOrderLive(admin, id, { refresh });
    if (!live) return NextResponse.json({ error: "No such work order in Zoho FSM" }, { status: 404 });
    const [serviceReports, files] = await Promise.all([
      fetchServiceReportsLive(admin, id, live.appointmentIds, { refresh }),
      fetchAttachmentsLive(admin, id, live.appointmentIds, { refresh }),
    ]);
    return NextResponse.json(
      { data: { serviceReports, files, appointments: live.appointmentIds.length } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof FsmLiveError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Work order files error:", error);
    return NextResponse.json({ error: "Could not read the files in Zoho FSM" }, { status: 500 });
  }
}

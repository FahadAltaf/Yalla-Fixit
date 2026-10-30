import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { buildComplianceReport, complianceFiltersSchema } from "@/lib/server/reports/compliance";
import { pagingSchema } from "@/lib/server/reports/reports";
import { logAccess, openReport } from "@/lib/server/reports/route-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * App usage compliance (BRD 5.2 B4; DEV-447, 448, 450). Compliance View
 * opens it; Export adds `?export=csv|xlsx` (the HR report's figures).
 *
 * Query: month (YYYY-MM), view (technicians | events | disputes),
 * technician, team, client, state (events: missed | waived | performed |
 * all), dispute (disputes: open | accepted | rejected), q, page, pageSize,
 * log=view.
 */

export const dynamic = "force-dynamic";
/* A first read of Zoho FSM for the dates can take half a minute (26 Oct: the reports read FSM live). */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const request = await openReport(req, "compliance");
  if (request instanceof NextResponse) return request;

  const filters = complianceFiltersSchema.safeParse(request.params);
  const paging = pagingSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success || !paging.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  const user = request.gate.access.accessUser;
  const can = {
    ...request.can,
    waive: hasResourceAction(user, ResourceType.COMPLIANCE, ActionType.EDIT),
    finalize: hasResourceAction(user, ResourceType.COMPLIANCE, ActionType.APPROVE),
    /* Raise a dispute for a technician: the supervisors and coordinators who waive. */
    raise: hasResourceAction(user, ResourceType.COMPLIANCE, ActionType.EDIT),
    /* Decide one: only the reviewers named in Reporting Settings (D-10). */
    review: (await readReportingSettings(request.admin)).compliance.disputeReviewerUserIds.includes(request.gate.access.profile.id),
  };

  try {
    const report = await buildComplianceReport(request.admin, filters.data, paging.data, { all: Boolean(request.exportFormat) });
    await logAccess(request, "compliance", filters.data, report.total);
    return NextResponse.json({ ...report, can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Compliance report error:", error);
    return NextResponse.json({ error: "Could not load the compliance report" }, { status: 500 });
  }
}

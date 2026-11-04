import { NextRequest, NextResponse } from "next/server";

import { pagingSchema } from "@/lib/server/reports/reports";
import { buildRevenueReport, revenueFiltersSchema } from "@/lib/server/reports/revenue";
import { logAccess, openReport } from "@/lib/server/reports/route-helpers";

/**
 * The revenue report (BRD 5.2 B5; DEV-454). Revenue View opens it; Export
 * adds `?export=csv|xlsx`, which returns every matching row and is logged.
 *
 * Query: view (clients | technicians | months | work_orders), from, to,
 * client, technician, team, kind (amc | one_time), q, page, pageSize,
 * log=view.
 */

export const dynamic = "force-dynamic";
/* A first read of Zoho FSM for the dates can take half a minute (26 Oct: the reports read FSM live). */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const request = await openReport(req, "revenue");
  if (request instanceof NextResponse) return request;

  const filters = revenueFiltersSchema.safeParse(request.params);
  const paging = pagingSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success || !paging.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const report = await buildRevenueReport(request.admin, filters.data, paging.data, { all: Boolean(request.exportFormat) });
    await logAccess(request, "revenue", filters.data, report.total);
    return NextResponse.json({ ...report, can: request.can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Revenue report error:", error);
    return NextResponse.json({ error: "Could not load the revenue report" }, { status: 500 });
  }
}

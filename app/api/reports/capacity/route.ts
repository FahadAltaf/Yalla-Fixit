import { NextRequest, NextResponse } from "next/server";

import { buildCapacityReport, capacityFiltersSchema } from "@/lib/server/reports/planning";
import { pagingSchema } from "@/lib/server/reports/reports";
import { logAccess, openReport } from "@/lib/server/reports/route-helpers";

/**
 * Forward capacity (BRD 5.2 B5; DEV-452). Capacity View opens it; Export
 * adds `?export=csv|xlsx`, which returns every matching booking and is
 * logged.
 *
 * Query: from, days (the horizon setting when not given), team,
 * technician, day (the bookings list), q, page, pageSize, log=view.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const request = await openReport(req, "capacity");
  if (request instanceof NextResponse) return request;

  const filters = capacityFiltersSchema.safeParse(request.params);
  const paging = pagingSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success || !paging.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const report = await buildCapacityReport(request.admin, filters.data, paging.data, { all: Boolean(request.exportFormat) });
    await logAccess(request, "capacity", filters.data, report.total);
    return NextResponse.json({ ...report, can: request.can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Capacity report error:", error);
    return NextResponse.json({ error: "Could not load the capacity report" }, { status: 500 });
  }
}

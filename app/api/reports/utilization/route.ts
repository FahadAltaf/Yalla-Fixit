import { NextRequest, NextResponse } from "next/server";

import { buildUtilizationReport, utilizationFiltersSchema } from "@/lib/server/reports/planning";
import { pagingSchema } from "@/lib/server/reports/reports";
import { logAccess, openReport } from "@/lib/server/reports/route-helpers";

/**
 * Technician utilization (BRD 5.2 B2; DEV-444). Utilization View opens it;
 * Export adds `?export=csv|xlsx`, which returns every matching row and is
 * logged.
 *
 * Query: view (technicians | teams | appointments), from, to, granularity
 * (day | week | month), technician, team, chargeability and missing=1
 * (appointments), q, page, pageSize, log=view.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const request = await openReport(req, "utilization");
  if (request instanceof NextResponse) return request;

  const filters = utilizationFiltersSchema.safeParse(request.params);
  const paging = pagingSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success || !paging.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const report = await buildUtilizationReport(request.admin, filters.data, paging.data, { all: Boolean(request.exportFormat) });
    await logAccess(request, "utilization", filters.data, report.total);
    return NextResponse.json({ ...report, can: request.can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Utilization report error:", error);
    return NextResponse.json({ error: "Could not load the utilization report" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { buildExceptionReport, exceptionFiltersSchema, pagingSchema } from "@/lib/server/reports/reports";
import { logAccess, openReport } from "@/lib/server/reports/route-helpers";

/**
 * The exception reports (BRD 5.2 B5; DEV-453). Exception reports View
 * opens them; Export adds `?export=csv|xlsx`, which returns every matching
 * row and is logged.
 *
 * Query: view (unflagged | actual_times), from, to, client, coordinator
 * (unflagged), technician and team (actual_times), overdue=1 (unflagged),
 * q, page, pageSize, log=view.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const request = await openReport(req, "exceptions");
  if (request instanceof NextResponse) return request;

  const filters = exceptionFiltersSchema.safeParse(request.params);
  const paging = pagingSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success || !paging.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const report = await buildExceptionReport(request.admin, filters.data, paging.data, { all: Boolean(request.exportFormat) });
    await logAccess(request, "exceptions", filters.data, report.total);
    return NextResponse.json({ ...report, can: request.can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Exception report error:", error);
    return NextResponse.json({ error: "Could not load the exception report" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { buildQuotationReport, pagingSchema, quotationFiltersSchema } from "@/lib/server/reports/reports";
import { logAccess, openReport } from "@/lib/server/reports/route-helpers";

/**
 * The quotation summary (BRD 5.2 B1; DEV-442). Quotation summary View
 * opens it; Export adds `?export=csv|xlsx`, which returns every matching
 * row and is logged.
 *
 * Query: from, to (created, YYYY-MM-DD), owner, client, band, status (a
 * status key or "open"), flag (breached | expiring | past_validity), q,
 * page, pageSize, log=view.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const request = await openReport(req, "quotations");
  if (request instanceof NextResponse) return request;

  const filters = quotationFiltersSchema.safeParse(request.params);
  const paging = pagingSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success || !paging.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const report = await buildQuotationReport(request.admin, filters.data, paging.data, { all: Boolean(request.exportFormat) });
    await logAccess(request, "quotations", filters.data, report.total);
    return NextResponse.json({ ...report, can: request.can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation summary error:", error);
    return NextResponse.json({ error: "Could not load the quotation summary" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { attendanceFiltersSchema, buildAttendanceReport } from "@/lib/server/reports/compliance";
import { pagingSchema } from "@/lib/server/reports/reports";
import { logAccess, openReport } from "@/lib/server/reports/route-helpers";

/**
 * Daily attendance (BRD 5.2 B5; DEV-451): per technician per day, the
 * shift, leave, check-in flags (once FSM's check-ins can be read, B-01)
 * and the day's work from FSM appointments; the monthly summary for HR.
 *
 * Query: view (days | summary), from, to, technician, team, status, q,
 * page, pageSize, export=csv|xlsx, log=view.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const request = await openReport(req, "attendance");
  if (request instanceof NextResponse) return request;

  const filters = attendanceFiltersSchema.safeParse(request.params);
  const paging = pagingSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filters.success || !paging.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const report = await buildAttendanceReport(request.admin, filters.data, paging.data, { all: Boolean(request.exportFormat) });
    await logAccess(request, "attendance", filters.data, report.total);
    return NextResponse.json({ ...report, can: request.can }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Attendance report error:", error);
    return NextResponse.json({ error: "Could not load the attendance report" }, { status: 500 });
  }
}

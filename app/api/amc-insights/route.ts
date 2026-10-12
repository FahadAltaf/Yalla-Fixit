import { NextRequest, NextResponse } from "next/server";

import { todayInDubai } from "@/lib/amc/contracts";
import { reportPeriod } from "@/lib/amc/reports";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { commercialReport, managementDashboard, operationalReport } from "@/lib/server/amc/insights";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The AMC management dashboard and the operational and commercial reports
 * (DEV-411, 412, 414), over the contracts the caller may see.
 *
 *   GET ?view=dashboard
 *   GET ?view=operational&from=YYYY-MM-DD&to=YYYY-MM-DD   (this month by default)
 *   GET ?view=commercial&from&to
 *
 * The Reports page's own permission (AMC Reports, View).
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.can(ResourceType.AMC_REPORTS, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC Reports." }, { status: 403 });
  }
  const p = req.nextUrl.searchParams;
  const who = { userId: gate.userId, canApprove: gate.seesAll };
  try {
    const config = await readAmcConfig(gate.admin);
    const view = p.get("view") ?? "dashboard";
    const period = reportPeriod(p.get("from"), p.get("to"), todayInDubai());
    const headers = { "Cache-Control": "no-store" };
    if (view === "operational") return NextResponse.json({ report: await operationalReport(gate.admin, who, period, config) }, { headers });
    if (view === "commercial") return NextResponse.json({ report: await commercialReport(gate.admin, who, period, config) }, { headers });
    if (view === "dashboard") return NextResponse.json({ dashboard: await managementDashboard(gate.admin, who, config) }, { headers });
    return NextResponse.json({ error: "Unknown report." }, { status: 400 });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the report");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { amcReports } from "@/lib/server/amc/business";
import { ActionType, ResourceType } from "@/types/types";

/**
 * AMC reports over the contracts the caller can see: portfolio metrics,
 * expiry buckets, renewal pipeline, account-manager portfolio and service
 * analytics. Filters: manager, customer, property (text).
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  /* The Reports page's own permission: the page guard alone does not stop the URL. */
  if (!gate.can(ResourceType.AMC_REPORTS, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC Reports." }, { status: 403 });
  }
  const p = req.nextUrl.searchParams;
  try {
    return NextResponse.json({
      reports: await amcReports(
        gate.admin,
        { userId: gate.userId, canApprove: gate.seesAll },
        { manager: p.get("manager"), customer: p.get("customer"), property: p.get("property") },
      ),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the reports");
  }
}

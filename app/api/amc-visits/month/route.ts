import { NextRequest, NextResponse } from "next/server";

import { todayInDubai } from "@/lib/amc/contracts";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { monthBounds, ppmMonth } from "@/lib/server/amc/ppm-month";

/**
 * GET ?month=YYYY-MM&mine=1 -- the coordinators' month of planned visits
 * (DEV-492): confirmed, contacted and not yet contacted. AMC Visits (View)
 * sees every coordinator's; anyone else with AMC sees their own contracts.
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const month = req.nextUrl.searchParams.get("month") ?? todayInDubai().slice(0, 7);
  if (!monthBounds(month)) return NextResponse.json({ error: "Month must be YYYY-MM." }, { status: 400 });
  const everyone = gate.visits.view || gate.seesAll;
  const mine = req.nextUrl.searchParams.get("mine") === "1" || !everyone;
  try {
    const result = await ppmMonth(gate.admin, month, mine ? gate.userId : null);
    return NextResponse.json({ ...result, month, mine, canSeeAll: everyone }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the month's visits");
  }
}

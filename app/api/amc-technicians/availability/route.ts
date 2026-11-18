import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { SITE_VISIT_MINUTES, availableInspectors } from "@/lib/server/amc/visits";

/**
 * GET /api/amc-technicians/availability?start=<ISO>&minutes=<n>&ignore=<assessmentId>&current=<userId>
 *
 * Who can inspect a site visit at that time and is free then (13-16 Nov
 * 2026): technicians (AMC work, live jobs, leave) and the rest of the team
 * (their other site visits), in one request when someone presses Find
 * available inspectors. `current` also says what the inspector already
 * chosen is booked on, if anything. Every AMC user may ask: it names
 * bookings, as the visit board already does.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  const start = params.get("start") ?? "";
  const minutes = Number(params.get("minutes") ?? SITE_VISIT_MINUTES);
  const ignore = params.get("ignore");
  const current = params.get("current");
  if (!start || Number.isNaN(Date.parse(start))) return NextResponse.json({ error: "Give a start time." }, { status: 400 });
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) return NextResponse.json({ error: "Give 15 to 1440 minutes." }, { status: 400 });
  if ((ignore && !UUID.test(ignore)) || (current && !UUID.test(current))) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(
      await availableInspectors(gate.admin, new Date(start).toISOString(), minutes, { ignoreAssessmentId: ignore, currentUserId: current }),
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not check who is free");
  }
}

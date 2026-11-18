import { NextRequest, NextResponse } from "next/server";

import { canReadContract } from "@/lib/amc/access";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { reportLink, serviceReportFacts, visitOwner } from "@/lib/server/amc/job-sheets";

/**
 * Opens the visit's stored service report (a link that expires in five
 * minutes), or with ?facts=1 the report's facts, which the portal draws and
 * builds the PDF from (18 Nov 2026).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ visitId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId } = await ctx.params;
  if (!UUID.test(visitId)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  try {
    const scope = await visitOwner(gate.admin, visitId);
    if (!scope.found || (!gate.visits.view && !gate.seesAll && !canReadContract(gate.actor, scope.ownerId))) {
      return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    }
    if (req.nextUrl.searchParams.get("facts")) {
      return NextResponse.json({ facts: await serviceReportFacts(gate.admin, visitId) }, { headers: { "Cache-Control": "no-store" } });
    }
    const url = await reportLink(gate.admin, visitId);
    if (!url) return NextResponse.json({ error: "This visit has no service report yet." }, { status: 404 });
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not open the report");
  }
}

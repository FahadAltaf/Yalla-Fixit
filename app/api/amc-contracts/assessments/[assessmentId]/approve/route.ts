import { NextRequest, NextResponse } from "next/server";

import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { approveSiteVisit } from "@/lib/server/amc/site-visit-approval";

/**
 * POST: approves a completed site visit; the scope and asset changes the
 * inspector made on site go onto the property. Only the visit's named
 * approver may (16 Nov 2026).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Site visit not found." }, { status: 404 });
  try {
    return NextResponse.json({ assessment: await approveSiteVisit(gate.admin, assessmentId, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not approve the site visit");
  }
}

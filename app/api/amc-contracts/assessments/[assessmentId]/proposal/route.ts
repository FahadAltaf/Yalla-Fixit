import { NextRequest, NextResponse } from "next/server";
import { canReadAssessment } from "@/lib/amc/access";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { createProposalFromAssessment } from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";

/**
 * Starts an AMC proposal from a completed assessment: a draft with the
 * customer, property and recommended services, unpriced. It opens in the
 * normal proposal wizard; approval is unchanged. Once per assessment.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  try {
    /* Only an assessment the caller may read (lib/amc/access.ts). */
    const { data: scope } = await gate.admin.from("amc_assessments").select("created_by").eq("id", assessmentId).maybeSingle<{ created_by: string | null }>();
    if (!scope || !canReadAssessment(gate.actor, scope.created_by)) {
      return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
    }
    return NextResponse.json(await createProposalFromAssessment(gate.admin, assessmentId, { id: gate.userId, label: gate.label }), {
      status: 201,
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not create the proposal");
  }
}

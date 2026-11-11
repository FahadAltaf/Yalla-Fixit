import { NextRequest, NextResponse } from "next/server";
import { canReadAssessment } from "@/lib/amc/access";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { createProposalFromAssessment } from "@/lib/server/amc/business";
import { readAmcConfig } from "@/lib/server/amc/config";
import { linkEnquiryProposal } from "@/lib/server/amc/enquiries";
import { UUID } from "@/lib/server/amc/business-schemas";

/**
 * Starts an AMC proposal from a completed assessment: a draft with the
 * customer, property and recommended services, unpriced. It opens in the
 * normal proposal wizard; approval is unchanged. Once per assessment.
 * Units counted on a site visit become the lines' units, and an enquiry's
 * site visit links the proposal back to the enquiry.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  try {
    /* Only an assessment the caller may read (lib/amc/access.ts). */
    const { data: scope } = await gate.admin
      .from("amc_assessments")
      .select("created_by, assessor_id")
      .eq("id", assessmentId)
      .maybeSingle<{ created_by: string | null; assessor_id: string | null }>();
    if (!scope || !canReadAssessment(gate.actor, scope.created_by, scope.assessor_id)) {
      return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
    }
    const actor = { id: gate.userId, label: gate.label };
    const result = await createProposalFromAssessment(gate.admin, assessmentId, actor);
    if (result.enquiryId) await linkEnquiryProposal(gate.admin, result.enquiryId, result.submissionId, actor, await readAmcConfig(gate.admin));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not create the proposal");
  }
}

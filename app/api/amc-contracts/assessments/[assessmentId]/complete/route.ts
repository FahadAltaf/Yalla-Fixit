import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { completeAssessment } from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";

/** Completes an assessment: dated, placed, every checklist item answered. It cannot be changed afterwards. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  try {
    const assessment = await completeAssessment(
      gate.admin,
      { userId: gate.userId, canApprove: gate.canApprove || gate.actor.ops.edit },
      assessmentId,
      { id: gate.userId, label: gate.label },
    );
    return NextResponse.json({ assessment });
  } catch (error) {
    return contractErrorResponse(error, "Could not complete the assessment");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { removeAssessmentPhoto } from "@/lib/server/amc/assessment-photos";
import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/** Removes a photo from a draft assessment. A completed assessment keeps its photos. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string; photoId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId, photoId } = await ctx.params;
  if (!UUID.test(assessmentId) || !UUID.test(photoId)) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  try {
    await removeAssessmentPhoto(gate.admin, { userId: gate.userId, canApprove: gate.canApprove }, assessmentId, photoId, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not remove the photo");
  }
}

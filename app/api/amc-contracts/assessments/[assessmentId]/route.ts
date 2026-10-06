import { NextRequest, NextResponse } from "next/server";
import { canReadAssessment } from "@/lib/amc/access";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { deleteDraftAssessment, getAssessment, updateAssessment } from "@/lib/server/amc/business";
import { UUID, updateAssessmentSchema } from "@/lib/server/amc/business-schemas";

/** One assessment: read, edit while a draft, delete a draft. Completed assessments are history. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  try {
    const assessment = await getAssessment(gate.admin, assessmentId);
    if (!canReadAssessment(gate.actor, assessment.createdBy)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
    return NextResponse.json({
      assessment,
      canEdit: assessment.status === "draft" && (gate.canApprove || gate.actor.ops.edit || assessment.createdBy === gate.userId),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the assessment");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  const parsed = updateAssessmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const assessment = await updateAssessment(gate.admin, { userId: gate.userId, canApprove: gate.canApprove || gate.actor.ops.edit }, assessmentId, parsed.data);
    return NextResponse.json({ assessment });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the assessment");
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  try {
    await deleteDraftAssessment(gate.admin, { userId: gate.userId, canApprove: gate.canApprove || gate.actor.ops.edit }, assessmentId, { id: gate.userId, label: gate.label });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not delete the draft");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { canReadAssessment } from "@/lib/amc/access";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { deleteDraftAssessment, getAssessment, updateAssessment } from "@/lib/server/amc/business";
import { UUID, updateAssessmentSchema } from "@/lib/server/amc/business-schemas";
import { notifyApproverReady, siteVisitPropertyView, siteVisitApprovers } from "@/lib/server/amc/site-visit-approval";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { siteVisitChecklist } from "@/lib/amc/site-visit-checklist";

/** One assessment: read, edit while a draft, delete a draft. Completed assessments are history. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  try {
    const assessment = await getAssessment(gate.admin, assessmentId);
    if (!canReadAssessment(gate.actor, assessment.createdBy, assessment.assessorId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
    const mayEdit = gate.canApprove || gate.actor.ops.edit || assessment.createdBy === gate.userId || assessment.assessorId === gate.userId;
    const canEdit = assessment.status === "draft" && mayEdit;

    /*
      The scope and asset changes the inspector made on site, held until the
      approver approves (16 Nov 2026), and whether this viewer is that approver.
    */
    const [{ changes, assets, scope }, photos, settings] = await Promise.all([
      siteVisitPropertyView(gate.admin, assessment),
      gate.admin.from("amc_assessment_photos").select("id", { count: "exact", head: true }).eq("assessment_id", assessment.id),
      readAmcSettings(gate.admin).catch(() => null),
    ]);
    /* Any site visit approver from AMC configuration may decide (24 Nov 2026); their names replace the one stored at booking. */
    const approvers = assessment.approverId ? await siteVisitApprovers(gate.admin, assessment) : null;
    const canApprove = assessment.status === "completed" && !assessment.approvedAt && !!approvers?.ids.includes(gate.userId);
    const shown = approvers?.names.length ? { ...assessment, approverName: approvers.names.join(" or ") } : assessment;
    /* The property's scope and assets as the inspector left them on site (16 Nov 2026). */
    /* What the approver checks (23 Nov 2026): what approving changes, and what the visit recorded (DEV-362). */
    const checklist = assessment.status === "completed"
      ? siteVisitChecklist({
          ...assessment,
          photoCount: photos.count ?? 0,
          assets: assets.filter((x) => x.change !== "delete"),
          scope: scope.filter((x) => x.change !== "delete"),
          changes: changes as Parameters<typeof siteVisitChecklist>[0]["changes"],
          serviceLabel: (id) => settings?.services?.find((s) => s.id === id)?.label ?? id,
        })
      : null;
    return NextResponse.json({ assessment: shown, canEdit, changes, canApprove, approversFrom: approvers?.from ?? null, siteAssets: assets, siteScope: scope, checklist });
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
    /* A new approver on a visit already completed is told it is waiting for them. */
    if (parsed.data.approverId && assessment.status === "completed" && assessment.approverId === parsed.data.approverId) {
      await notifyApproverReady(gate.admin, assessment).catch(() => undefined);
    }
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

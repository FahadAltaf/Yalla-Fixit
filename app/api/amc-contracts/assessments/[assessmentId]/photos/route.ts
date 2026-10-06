import { NextRequest, NextResponse } from "next/server";
import { canReadAssessment } from "@/lib/amc/access";

import { AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { addAssessmentPhoto, listAssessmentPhotos } from "@/lib/server/amc/assessment-photos";
import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/**
 * Photos of an assessment. Stored privately; listed with links that expire
 * in ten minutes. Added only while the assessment is a draft.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
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
    return NextResponse.json(await listAssessmentPhotos(gate.admin, assessmentId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the photos");
  }
}

/** multipart/form-data: `file` (JPEG, PNG or WebP, at most 10 MB) and an optional `caption`. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > AMC_PHOTO_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "A photo can be at most 10 MB." }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Choose a photo to add." }, { status: 400 });
  const caption = form?.get("caption");
  try {
    const photo = await addAssessmentPhoto(
      gate.admin,
      { userId: gate.userId, canApprove: gate.canApprove || gate.actor.ops.edit },
      assessmentId,
      { bytes: new Uint8Array(await file.arrayBuffer()), caption: typeof caption === "string" ? caption : null },
      { id: gate.userId, label: gate.label },
    );
    return NextResponse.json({ photo }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not add the photo");
  }
}

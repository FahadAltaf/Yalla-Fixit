import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { removeVisitPhoto, visitOwner } from "@/lib/server/amc/job-sheets";

/** Removes a photo from a job sheet that is still a draft or returned. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ visitId: string; photoId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId, photoId } = await ctx.params;
  if (!UUID.test(visitId) || !UUID.test(photoId)) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  try {
    const scope = await visitOwner(gate.admin, visitId);
    if (!scope.found) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    if (!(gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, scope.ownerId))) {
      return NextResponse.json({ error: "You cannot fill in this job sheet." }, { status: 403 });
    }
    return NextResponse.json(await removeVisitPhoto(gate.admin, visitId, photoId));
  } catch (error) {
    return contractErrorResponse(error, "Could not remove the photo");
  }
}

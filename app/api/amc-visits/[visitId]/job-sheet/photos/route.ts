import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { addVisitPhoto, visitOwner } from "@/lib/server/amc/job-sheets";

/**
 * Photos on a visit's job sheet (before, after, fault, other). Stored
 * privately in amc-documents; added only while the sheet is a draft or
 * returned. multipart/form-data: `file` (JPEG, PNG or WebP, at most 10 MB),
 * `kind`, and optional `lineId`, `assetId`, `caption`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["before", "after", "fault", "other"] as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ visitId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId } = await ctx.params;
  if (!UUID.test(visitId)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > AMC_PHOTO_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "A photo can be at most 10 MB." }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Choose a photo to add." }, { status: 400 });
  const kind = String(form?.get("kind") ?? "other");
  if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Say whether it is a before, after or fault photo." }, { status: 400 });
  const field = (name: string) => {
    const v = form?.get(name);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const lineId = field("lineId");
  const assetId = field("assetId");
  if ((lineId && !UUID.test(lineId)) || (assetId && !UUID.test(assetId))) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const scope = await visitOwner(gate.admin, visitId);
    if (!scope.found) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    if (!(gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, scope.ownerId))) {
      return NextResponse.json({ error: "You cannot fill in this job sheet." }, { status: 403 });
    }
    const photo = await addVisitPhoto(
      gate.admin,
      visitId,
      { bytes: new Uint8Array(await file.arrayBuffer()), kind: kind as (typeof KINDS)[number], lineId, assetId, caption: field("caption")?.slice(0, 300) ?? null },
      { id: gate.userId, label: gate.label },
    );
    return NextResponse.json({ photo }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not add the photo");
  }
}

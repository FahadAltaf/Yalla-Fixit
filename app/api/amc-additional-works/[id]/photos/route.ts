import { NextRequest, NextResponse } from "next/server";

import { AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { additionalWorkOwner } from "@/lib/server/amc/additional-works";
import { addWorkPhoto, removeWorkPhoto } from "@/lib/server/amc/call-outs";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/**
 * Photos of an additional work's finding.
 * POST multipart/form-data `file` (JPEG, PNG or WebP, at most 10 MB), `kind`, optional `caption`.
 * DELETE ?photoId
 */
const KINDS = ["finding", "before", "after", "other"] as const;

async function gateFor(id: string) {
  const gate = await requireContractAccess();
  if (!gate.ok) return { response: gate.response } as const;
  if (!UUID.test(id)) return { response: NextResponse.json({ error: "Additional work not found." }, { status: 404 }) } as const;
  const scope = await additionalWorkOwner(gate.admin, id);
  const rights = fieldWorkRights(gate, "additional_works", scope.ownerId);
  if (!scope.found || !rights.view) return { response: NextResponse.json({ error: "Additional work not found." }, { status: 404 }) } as const;
  if (!rights.edit) return { response: NextResponse.json({ error: "You cannot change this additional work." }, { status: 403 }) } as const;
  return { gate } as const;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateFor(id);
  if ("response" in g) return g.response;
  if (Number(req.headers.get("content-length") ?? 0) > AMC_PHOTO_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "A photo can be at most 10 MB." }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Choose a photo to add." }, { status: 400 });
  const kind = String(form?.get("kind") ?? "finding");
  if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Unknown photo kind." }, { status: 400 });
  const caption = form?.get("caption");
  try {
    const photo = await addWorkPhoto(
      g.gate.admin,
      { additionalWorkId: id },
      { bytes: new Uint8Array(await file.arrayBuffer()), kind: kind as (typeof KINDS)[number], caption: typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 300) : null },
      { id: g.gate.userId, label: g.gate.label },
    );
    return NextResponse.json({ photo }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not add the photo");
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateFor(id);
  if ("response" in g) return g.response;
  const photoId = req.nextUrl.searchParams.get("photoId") ?? "";
  if (!UUID.test(photoId)) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  try {
    return NextResponse.json(await removeWorkPhoto(g.gate.admin, { additionalWorkId: id }, photoId));
  } catch (error) {
    return contractErrorResponse(error, "Could not remove the photo");
  }
}

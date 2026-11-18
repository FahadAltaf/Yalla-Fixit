import { NextRequest, NextResponse } from "next/server";

import { AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { mobilePushSchema } from "@/lib/amc/mobile-sync";
import { applyMobilePush, mobileErrorResponse, requireMobileTechnician } from "@/lib/server/amc/mobile-sync";

/**
 * POST /api/amc-sync/push -- the mobile app's queued AMC changes, in one request.
 *
 * multipart/form-data: `body` (JSON: { device_id, free_bytes, mutations })
 * and one file per photo being added, named `photo:<photo id>`. A request
 * with no photos may be plain JSON. Changes are applied in order; each
 * comes back applied, duplicate (already done), retry or rejected, as the
 * Snagging push does, so one bad change never strands the rest.
 *
 *   amc_sheet  update   save the visit's job sheet (draft)
 *   amc_submit insert   save and submit it for the supervisor's review
 *   amc_photo  insert   add a photo (before / after / fault / other)
 *   amc_photo  delete   remove one, while the sheet is still a draft
 */
/* Serverless hosts cap a body near 4.5 MB; the app keeps a request under 3.5 MB of photos. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const gate = await requireMobileTechnician(req);
  if (!gate.ok) return gate.response;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Too much in one request." }, { status: 413 });
  }

  let body: unknown;
  const files = new Map<string, Uint8Array>();
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    try {
      body = JSON.parse(String(form.get("body") ?? ""));
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("photo:") || !(value instanceof Blob)) continue;
      if (value.size > AMC_PHOTO_MAX_BYTES) continue;
      files.set(key.slice("photo:".length), new Uint8Array(await value.arrayBuffer()));
    }
  } else {
    body = await req.json().catch(() => null);
  }

  const parsed = mobilePushSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ data: await applyMobilePush(gate.tech, parsed.data.mutations, files) });
  } catch (error) {
    return mobileErrorResponse(error, "Could not send the changes");
  }
}

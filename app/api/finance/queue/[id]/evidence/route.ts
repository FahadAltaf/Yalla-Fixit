import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  EVIDENCE_BUCKET,
  EVIDENCE_MAX_BYTES,
  evidenceContentType,
  evidencePrefix,
  safeEvidenceName,
} from "@/lib/finance/evidence";
import { hasResourceAction } from "@/lib/role-permissions";
import { UUID_PATTERN } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Evidence for an exclusion request (BRD §5.1 Step 5, TC05).
 *
 * POST mints a one-time upload URL: the file goes from the browser
 * straight to the private bucket, so a scanned PDF is not bounded by the
 * request body limit. The path is returned and sent with the exclusion
 * request, which only accepts paths under this item.
 *
 * GET ?path= opens a file that is attached to one of this item's
 * exclusions, through a signed URL that lasts a minute.
 */

const signSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().max(200).default(""),
    size: z.number().int().positive(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
  if (!gate.ok) return gate.response;

  const parsed = signSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  const { fileName, size } = parsed.data;

  const contentType = evidenceContentType(fileName, parsed.data.contentType);
  if (!contentType) {
    return NextResponse.json({ error: `${fileName}: PDF, image, email or Office files only` }, { status: 400 });
  }
  if (size > EVIDENCE_MAX_BYTES) {
    return NextResponse.json({ error: `${fileName} is over 10 MB` }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();
    const { data: item, error: itemError } = await admin
      .schema("finance")
      .from("queue_items")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (itemError) throw new Error(itemError.message);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const path = `${evidencePrefix(id)}${randomUUID()}-${safeEvidenceName(fileName)}`;
    const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(error.message);

    return NextResponse.json({ path, signedUrl: data.signedUrl, contentType });
  } catch (error) {
    console.error("Finance evidence sign error:", error);
    return NextResponse.json({ error: "Could not prepare the upload" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!UUID_PATTERN.test(id) || !path.startsWith(evidencePrefix(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Whoever may open the item may open its evidence (the item route's rule).
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (
    !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = await createAdminServerClient();
    // Only a file that was actually attached to a request on this item.
    const { data: attached, error: lookupError } = await admin
      .schema("finance")
      .from("exclusions")
      .select("id")
      .eq("queue_item_id", id)
      .contains("evidence", [path])
      .limit(1);
    if (lookupError) throw new Error(lookupError.message);
    if (!attached?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 60);
    if (error) throw new Error(error.message);
    return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Finance evidence open error:", error);
    return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
  }
}

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  EVIDENCE_BUCKET,
  EVIDENCE_MAX_BYTES,
  evidenceContentType,
  safeEvidenceName,
  workOrderEvidencePrefix,
} from "@/lib/finance/evidence";
import { hasResourceAction } from "@/lib/role-permissions";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Evidence for a work order's not-invoiceable request (BRD 5.1 Step 5),
 * as the queue item's evidence route: POST mints a one-time upload URL
 * under wo/<work order>/; GET ?path= opens a file attached to one of this
 * work order's requests, through a link that lasts a minute.
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;
const signSchema = z
  .object({ fileName: z.string().trim().min(1).max(255), contentType: z.string().max(200).default(""), size: z.number().int().positive() })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
  if (!gate.ok) return gate.response;
  const parsed = signSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  const { fileName, size } = parsed.data;
  const contentType = evidenceContentType(fileName, parsed.data.contentType);
  if (!contentType) return NextResponse.json({ error: `${fileName}: PDF, image, email or Office files only` }, { status: 400 });
  if (size > EVIDENCE_MAX_BYTES) return NextResponse.json({ error: `${fileName} is over 10 MB` }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const path = `${workOrderEvidencePrefix(id)}${randomUUID()}-${safeEvidenceName(fileName)}`;
    const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return NextResponse.json({ path, signedUrl: data.signedUrl, contentType });
  } catch (error) {
    console.error("Work order evidence sign error:", error);
    return NextResponse.json({ error: "Could not prepare the upload" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!ID.test(id) || !path.startsWith(workOrderEvidencePrefix(id)) || path.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
    // Only a file that was actually attached to a request on this work order.
    const { data: attached, error: lookupError } = await admin
      .schema("finance")
      .from("wo_exclusions")
      .select("id")
      .eq("fsm_work_order_id", id)
      .contains("evidence", [path])
      .limit(1);
    if (lookupError) throw new Error(lookupError.message);
    if (!attached?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 60);
    if (error) throw new Error(error.message);
    return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Work order evidence open error:", error);
    return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
  }
}

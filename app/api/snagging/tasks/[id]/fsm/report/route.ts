import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { syncJobToFsm } from "@/lib/server/snagging/fsm-job-sync";
import { ActionType, ResourceType } from "@/types/types";

/* FSM's own limit for a file (Zoho: "Upload a file", 20MB). */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/snagging/tasks/[id]/fsm/report -- the client report PDF, from the
 * report page, attached to the job's FSM work order (SNG-189).
 *
 * For when the server could not make the PDF itself on approval: the report
 * page builds the same document the Download button gives, and hands it
 * over here. Multipart, field "file"; optional field "version".
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "Attach the report PDF as \"file\"." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "The report is over FSM's 20MB limit." }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A PDF starts "%PDF"; anything else is not the report.
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return NextResponse.json({ error: "That file is not a PDF." }, { status: 400 });
    }
    const versionRaw = Number(form?.get("version"));
    const admin = await createAdminServerClient();
    const result = await syncJobToFsm(admin, id, {
      actorId: profile.id,
      pdf: { bytes, version: Number.isInteger(versionRaw) && versionRaw > 0 ? versionRaw : null },
    });
    return NextResponse.json({ data: result }, { status: result.ok ? 200 : 502 });
  } catch (error) {
    console.error("Snagging job FSM report POST error:", error);
    return NextResponse.json({ error: "Failed to attach the report in Zoho FSM" }, { status: 500 });
  }
}

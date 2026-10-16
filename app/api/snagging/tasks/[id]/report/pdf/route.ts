import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { fsmSyncEnabled } from "@/lib/server/snagging/fsm-quotation-sync";
import { queueJobFsmSync } from "@/lib/server/snagging/fsm-job-sync";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import { storeReportPdf } from "@/lib/server/snagging/report-generate";
import { ActionType, ResourceType } from "@/types/types";

/* Zoho FSM's own limit for a file (20MB); the stored copy goes there too. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/snagging/tasks/[id]/report/pdf -- a report version's PDF, made
 * in the browser in the report page's design.
 *
 * The report page's PDF is built in the browser (the design is a React
 * component), so the approving manager's browser makes it straight after
 * approval and hands it here; so do the report page and the FSM card when a
 * version has none. It is stored as the version's file and then sent to the
 * job's Zoho FSM work order.
 *
 * Multipart: field "file" (the PDF), optional "versionId" (else the job's
 * newest version). 409 while the job has no version yet: approval issues it
 * a moment after answering, so the browser asks again.
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
      return NextResponse.json({ error: 'Attach the report PDF as "file".' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "The report is over the 20MB limit." }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A PDF starts "%PDF"; anything else is not the report.
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return NextResponse.json({ error: "That file is not a PDF." }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    // A visit's or round's report is a version of the root inspection's.
    const { rootId } = await loadJobFamily(admin, id);
    const askedVersion = String(form?.get("versionId") ?? "").trim();
    const { data: version } = askedVersion
      ? await admin
          .from("snagging_report_versions")
          .select("id, job_id")
          .eq("id", askedVersion)
          .eq("job_id", rootId)
          .maybeSingle()
      : await admin
          .from("snagging_report_versions")
          .select("id, job_id")
          .eq("job_id", rootId)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
    if (!version) {
      return NextResponse.json({ error: "This job has no report version yet." }, { status: 409 });
    }

    const stored = await storeReportPdf(admin, version.id as string, bytes, {
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
    });
    if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 500 });

    /*
      This very file goes to the root job's FSM work order -- even when the
      same version number is already there (an earlier file in the old
      design, or "Attach the report again"), so FSM always ends up with the
      document the client gets.
    */
    if (fsmSyncEnabled()) queueJobFsmSync(admin, rootId, profile.id, { bytes, version: stored.version });

    return NextResponse.json({ data: { versionId: stored.versionId, version: stored.version } });
  } catch (error) {
    console.error("Snagging report PDF POST error:", error);
    return NextResponse.json({ error: "Failed to store the report PDF" }, { status: 500 });
  }
}

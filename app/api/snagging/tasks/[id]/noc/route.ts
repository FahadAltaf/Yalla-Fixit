import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { mayWriteJob } from "@/lib/server/snagging/job-roster";
import { SNAGGING_BUCKET, signPaths } from "@/lib/server/snagging/media";
import { ActionType, ResourceType } from "@/types/types";

/** Long enough to download on a slow site connection. */
const NOC_URL_TTL_SECONDS = 15 * 60;

type JobRow = {
  id: string;
  inspector_id: string | null;
  noc_required: boolean | null;
  noc_path: string | null;
  property_record:
    | { noc_required: boolean | null; noc_path: string | null }
    | { noc_required: boolean | null; noc_path: string | null }[]
    | null;
};

/**
 * GET /api/snagging/tasks/[id]/noc — a short-lived link to the job's NOC,
 * for the inspector's phone.
 *
 * When the requester is not the owner, the developer will not open the
 * unit without the owner's NOC, and the inspector is the one standing at
 * the door. The document lives on the property record (or, for older
 * jobs, on the job itself), which the phone never syncs, so it is fetched
 * on demand here. The link is signed per request rather than synced,
 * because a synced link would have expired by the time it was needed.
 *
 * Only someone working the job -- its inspectors (the roster, a return
 * visit's crew, a room's inspector) -- or an admin.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    const { data: job, error } = await admin
      .from("snagging_jobs")
      .select<string, JobRow>(
        "id, inspector_id, noc_required, noc_path, property_record:property_id(noc_required, noc_path)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    /*
      Anyone working the job. This only let the lead and inspectors with a
      room of their own through, so the other inspectors on a shared job --
      the roster, and a return visit's crew -- were refused the NOC at the
      very door it exists for. The roster check is the one the rest of the
      sync uses.
    */
    if (
      job.inspector_id !== profile.id &&
      !isAdminUser(accessUser) &&
      !(await mayWriteJob(admin, id, profile.id))
    ) {
      return NextResponse.json({ error: "Not assigned to this inspection" }, { status: 403 });
    }

    // The property record wins, as it does on the job page.
    const rec = Array.isArray(job.property_record) ? job.property_record[0] : job.property_record;
    const required = Boolean(rec ? rec.noc_required : job.noc_required);
    const path = (rec ? rec.noc_path : job.noc_path) ?? null;

    if (!path) {
      return NextResponse.json({ data: { required, url: null, file_name: null } });
    }

    const signed = await signPaths(admin, [path], NOC_URL_TTL_SECONDS);
    const url = signed.get(path) ?? null;
    if (!url) {
      return NextResponse.json(
        { error: "The NOC file could not be found. Ask the office to upload it again." },
        { status: 404 },
      );
    }

    /*
      A second link that saves the file instead of showing it: storage sends
      it as an attachment under this name, so the phone's browser downloads
      it rather than opening a viewer. Signed per request like the other.
    */
    const fileName = path.split("/").pop() ?? "noc";
    const { data: download } = await admin.storage
      .from(SNAGGING_BUCKET)
      .createSignedUrl(path, NOC_URL_TTL_SECONDS, { download: fileName });

    return NextResponse.json({
      data: {
        required,
        url,
        download_url: download?.signedUrl ?? url,
        file_name: fileName,
        expires_in: NOC_URL_TTL_SECONDS,
      },
    });
  } catch (error) {
    console.error("Snagging NOC link error:", error);
    return NextResponse.json({ error: "Failed to load the NOC" }, { status: 500 });
  }
}

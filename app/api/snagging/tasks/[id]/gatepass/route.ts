import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { hasGatepass } from "@/lib/server/snagging/columns";
import { mayWriteJob } from "@/lib/server/snagging/job-roster";
import { SNAGGING_BUCKET, signPaths } from "@/lib/server/snagging/media";
import { ActionType, ResourceType } from "@/types/types";

/** Long enough to download on a slow site connection. */
const GATEPASS_URL_TTL_SECONDS = 15 * 60;

/**
 * GET /api/snagging/tasks/[id]/gatepass — a short-lived link to the job's
 * gate pass, for the inspector's phone.
 *
 * Building security asks for it at the gate, and the inspector is the one
 * standing there. The office uploads it to the job; the phone is told only
 * that one is on file (gatepass_on_file, in the sync) and fetches the file
 * here on demand. Signed per request rather than synced, because a synced
 * link would have expired by the time it was needed -- the same reasoning
 * as the NOC beside it (../noc).
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

    // Where the migration has not run there is no gate pass to open.
    if (!(await hasGatepass(admin))) {
      return NextResponse.json({ data: { url: null, file_name: null } });
    }

    const { data: job, error } = await admin
      .from("snagging_jobs")
      .select<string, { id: string; inspector_id: string | null; gatepass_path: string | null }>(
        "id, inspector_id, gatepass_path",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    if (
      job.inspector_id !== profile.id &&
      !isAdminUser(accessUser) &&
      !(await mayWriteJob(admin, id, profile.id))
    ) {
      return NextResponse.json({ error: "Not assigned to this inspection" }, { status: 403 });
    }

    const path = job.gatepass_path ?? null;
    if (!path) {
      return NextResponse.json({ data: { url: null, file_name: null } });
    }

    const signed = await signPaths(admin, [path], GATEPASS_URL_TTL_SECONDS);
    const url = signed.get(path) ?? null;
    if (!url) {
      return NextResponse.json(
        { error: "The gate pass file could not be found. Ask the office to upload it again." },
        { status: 404 },
      );
    }

    // A second link that saves the file instead of showing it, as for the NOC.
    const fileName = path.split("/").pop() ?? "gatepass";
    const { data: download } = await admin.storage
      .from(SNAGGING_BUCKET)
      .createSignedUrl(path, GATEPASS_URL_TTL_SECONDS, { download: fileName });

    return NextResponse.json({
      data: {
        url,
        download_url: download?.signedUrl ?? url,
        file_name: fileName,
        expires_in: GATEPASS_URL_TTL_SECONDS,
      },
    });
  } catch (error) {
    console.error("Snagging gate pass link error:", error);
    return NextResponse.json({ error: "Failed to load the gate pass" }, { status: 500 });
  }
}

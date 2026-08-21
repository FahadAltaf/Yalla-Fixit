import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { SNAGGING_BUCKET, mediaObjectKey } from "@/lib/server/snagging/media";
import { mediaSignSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Mints a one-shot upload URL for a photo, video, or signature.
 *
 * The binary goes from the phone straight to storage rather than
 * through this API: a 100-snag inspection is a couple of hundred
 * megabytes of evidence, and proxying that through a serverless
 * function would be slower, more fragile on a site connection, and
 * bounded by the request body limit.
 *
 * The object key is derived from the client-generated media id, so an
 * upload retried after a dropped connection overwrites its own object
 * instead of leaving an orphan behind (FR-3.03).
 */
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = mediaSignSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    // The job the evidence belongs to has to exist. `task_id` is the job
    // id in the lean schema; a mobile inspector may only add evidence to
    // a job assigned to them.
    const { data: job, error: jobError } = await admin
      .from("snagging_jobs")
      .select("id, inspector_id")
      .eq("id", input.task_id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.inspector_id && job.inspector_id !== profile.id) {
      return NextResponse.json({ error: "Not assigned to this inspection" }, { status: 403 });
    }

    const path = mediaObjectKey({
      taskId: input.task_id,
      mediaId: input.media_id,
      kind: input.kind,
      contentType: input.content_type,
    });

    const { data, error } = await admin.storage
      .from(SNAGGING_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({
      data: {
        bucket: SNAGGING_BUCKET,
        path,
        signed_url: data.signedUrl,
        token: data.token,
      },
    });
  } catch (error) {
    console.error("Snagging media sign error:", error);
    return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 });
  }
}

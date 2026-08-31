import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { SNAGGING_BUCKET } from "@/lib/server/snagging/media";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Job documents: title deed (E8) and NOC / authorization letter (E10).
 *
 * Both are optional and never block the job. Like the floor plan, the file
 * is uploaded server-side from a multipart form into the private `snagging`
 * bucket, and its object key is written onto the job column.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);
const COLUMN: Record<string, "title_deed_path" | "noc_path"> = {
  title_deed: "title_deed_path",
  noc: "noc_path",
};

function extFor(type: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  return map[type] ?? "";
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const taskId = form.get("task_id");
    const kind = String(form.get("kind") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (typeof taskId !== "string" || !taskId) {
      return NextResponse.json({ error: "Missing task_id" }, { status: 400 });
    }
    const column = COLUMN[kind];
    if (!column) {
      return NextResponse.json({ error: "kind must be title_deed or noc" }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Documents must be PNG, JPG, WEBP or PDF" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Document exceeds 15MB" }, { status: 400 });
    }

    const admin = await createAdminServerClient();

    const { data: job, error: jobError } = await admin
      .from("snagging_jobs")
      .select("id, property_id")
      .eq("id", taskId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const path = `tasks/${taskId}/documents/${kind}${extFor(file.type)}`;
    const { error: uploadError } = await admin.storage
      .from(SNAGGING_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    // Documents belong to the property record now (BR-1). Fall back to the
    // job column only if the job predates a property link.
    if (job.property_id) {
      const { error: updateError } = await admin
        .from("snagging_properties")
        .update({ [column]: path, updated_at: new Date().toISOString() })
        .eq("id", job.property_id);
      if (updateError) throw new Error(updateError.message);
    } else {
      const { error: updateError } = await admin
        .from("snagging_jobs")
        .update({ [column]: path })
        .eq("id", taskId);
      if (updateError) throw new Error(updateError.message);
    }

    return NextResponse.json({ data: { kind, storage_path: path } }, { status: 201 });
  } catch (error) {
    console.error("Snagging document upload error:", error);
    return NextResponse.json({ error: "Failed to upload the document" }, { status: 500 });
  }
}

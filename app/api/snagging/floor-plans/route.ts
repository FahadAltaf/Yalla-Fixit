import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { SNAGGING_BUCKET } from "@/lib/server/snagging/media";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Floor-plan upload for a job (FR-1.02).
 *
 * The portal uploads a plan server-side from a multipart form rather
 * than through the signed-URL dance the mobile app uses: a plan is a
 * single image well under the size limit, and a straight server upload
 * is simpler and needs no browser storage client. The mobile signed-URL
 * path stays for the hundreds of large photos a device streams.
 *
 * The plan lands in the private `snagging` bucket, and its 0..1 pin
 * fractions are resolved back to pixels using the width/height the
 * client read on upload.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);

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
    const label = (form.get("label") as string) || "Floor plan";
    const width = Number(form.get("width") ?? 0) || null;
    const height = Number(form.get("height") ?? 0) || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (typeof taskId !== "string" || !taskId) {
      return NextResponse.json({ error: "Missing task_id" }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { error: "Floor plans must be PNG, JPG, WEBP or PDF" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Floor plan exceeds 15MB" }, { status: 400 });
    }

    const admin = await createAdminServerClient();

    // The task the plan belongs to has to exist and carry a property, so
    // the plan is reachable from either side (FR-1.02).
    const { data: task, error: taskError } = await admin
      .from("snagging_tasks")
      .select("id, property_id")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const extension = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `tasks/${taskId}/floor-plans/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from(SNAGGING_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { data: row, error: insertError } = await admin
      .from("snagging_floor_plans")
      .insert({
        task_id: taskId,
        property_id: task.property_id,
        label,
        storage_path: path,
        mime_type: file.type,
        width,
        height,
        bytes: file.size,
        uploaded_by: profile.id,
      })
      .select("id, label, storage_path, width, height")
      .single();
    if (insertError) throw new Error(insertError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: taskId,
      taskId,
      eventType: "floor_plan_added",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { label, bytes: file.size },
    });

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    console.error("Snagging floor-plan upload error:", error);
    return NextResponse.json({ error: "Failed to upload the floor plan" }, { status: 500 });
  }
}

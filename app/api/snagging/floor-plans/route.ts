import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { SNAGGING_BUCKET, mediaObjectKey, signMediaPaths } from "@/lib/server/snagging/media";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Floor plans for a job (G3, FR-1.02).
 *
 * A job can carry several plans — one per floor. Each is its own row in
 * snagging_floor_plans and its own object, keyed by the plan id so a new
 * upload adds a floor rather than replacing the last. The portal uploads
 * server-side from a multipart form (a plan is one modest image); the
 * mobile signed-URL path is only for the hundreds of large snag photos.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);

/** GET /api/snagging/floor-plans?task_id=… — the job's plans, signed for display. */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const taskId = req.nextUrl.searchParams.get("task_id");
    if (!taskId) return NextResponse.json({ error: "Missing task_id" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_floor_plans")
      .select("id, job_id, label, storage_path, width, height, sort_order")
      .eq("job_id", taskId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);

    const signed = await signMediaPaths(admin, data ?? []);
    return NextResponse.json({ data: signed });
  } catch (error) {
    console.error("Snagging floor-plan GET error:", error);
    return NextResponse.json({ error: "Failed to load floor plans" }, { status: 500 });
  }
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
    const label = ((form.get("label") as string) || "Floor plan").trim() || "Floor plan";
    const width = Number(form.get("width") ?? 0) || null;
    const height = Number(form.get("height") ?? 0) || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (typeof taskId !== "string" || !taskId) {
      return NextResponse.json({ error: "Missing task_id" }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Floor plans must be PNG, JPG, WEBP or PDF" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Floor plan exceeds 15MB" }, { status: 400 });
    }

    const admin = await createAdminServerClient();

    const { data: job, error: jobError } = await admin
      .from("snagging_jobs")
      .select("id")
      .eq("id", taskId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Each plan is its own object, keyed by its own id, so uploads add
    // floors instead of overwriting one another.
    const planId = crypto.randomUUID();
    const path = mediaObjectKey({
      taskId,
      mediaId: planId,
      kind: "floor_plan",
      contentType: file.type,
    });

    const { error: uploadError } = await admin.storage
      .from(SNAGGING_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    // Append after the existing plans.
    const { count } = await admin
      .from("snagging_floor_plans")
      .select("id", { count: "exact", head: true })
      .eq("job_id", taskId);

    const { data: row, error: insertError } = await admin
      .from("snagging_floor_plans")
      .insert({
        id: planId,
        job_id: taskId,
        label,
        storage_path: path,
        width,
        height,
        sort_order: count ?? 0,
      })
      .select("id, job_id, label, storage_path, width, height, sort_order")
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

/**
 * PATCH /api/snagging/floor-plans — reorder plans (FR-3.06) and/or relabel one.
 * Body: { order: string[] } sets each plan's sort_order to its index, so the
 * floor sequence is explicit and stable — never inferred from the label.
 * Or: { id, label } to rename a single plan.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      order?: unknown;
      id?: unknown;
      label?: unknown;
    };
    const admin = await createAdminServerClient();

    // Reorder: assign sort_order by position in the given id list.
    if (Array.isArray(body.order)) {
      const ids = body.order.filter((v): v is string => typeof v === "string");
      if (ids.length === 0) return NextResponse.json({ error: "Empty order" }, { status: 400 });
      // Update one row per id; the list is short (one entry per floor).
      for (let i = 0; i < ids.length; i += 1) {
        const { error } = await admin
          .from("snagging_floor_plans")
          .update({ sort_order: i })
          .eq("id", ids[i]);
        if (error) throw new Error(error.message);
      }
      return NextResponse.json({ data: { order: ids } });
    }

    // Rename a single plan.
    if (typeof body.id === "string" && typeof body.label === "string") {
      const label = body.label.trim() || "Floor plan";
      const { error } = await admin
        .from("snagging_floor_plans")
        .update({ label })
        .eq("id", body.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ data: { id: body.id, label } });
    }

    return NextResponse.json({ error: "Provide `order` or `id` + `label`" }, { status: 400 });
  } catch (error) {
    console.error("Snagging floor-plan PATCH error:", error);
    return NextResponse.json({ error: "Failed to update floor plans" }, { status: 500 });
  }
}

/** DELETE /api/snagging/floor-plans?id=… — remove one plan (object + row). */
export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { data: plan, error: loadError } = await admin
      .from("snagging_floor_plans")
      .select("id, storage_path")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!plan) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

    // Clear any area pins that sat on this plan so no stale coordinates linger.
    // (The FK also nulls floor_plan_id via ON DELETE SET NULL; the areas
    // themselves are always preserved — FR-3.07.)
    await admin
      .from("snagging_areas")
      .update({ floor_plan_id: null, pin_x: null, pin_y: null })
      .eq("floor_plan_id", id);

    if (plan.storage_path) await admin.storage.from(SNAGGING_BUCKET).remove([plan.storage_path]);
    const { error: deleteError } = await admin.from("snagging_floor_plans").delete().eq("id", id);
    if (deleteError) throw new Error(deleteError.message);

    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("Snagging floor-plan DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete the floor plan" }, { status: 500 });
  }
}

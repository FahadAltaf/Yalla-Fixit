import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { signMediaPaths } from "@/lib/server/snagging/media";
import { updateTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * One inspection with everything the detail screen and the approval
 * review need: areas, snags with photo evidence, assignees, and the
 * approval history (FR-4.05).
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

    const { data: task, error } = await admin
      .from("snagging_tasks")
      .select(
        `*,
         property:snagging_properties(*),
         areas:snagging_areas(*),
         assignees:snagging_task_assignees(id, task_id, user_id, role,
           user_profile:user_id(id, full_name, email, profile_image)),
         approvals:snagging_approvals(id, task_id, action, rejection_category, comment,
           actor_id, created_at, actor:user_profile(full_name, email)),
         floor_plans:snagging_floor_plans(*),
         submissions:snagging_submissions(*)`,
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!task) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // Snags are fetched separately: a 478-snag inspection nested inside
    // the task select produces a response big enough to time out, and
    // the photo join multiplies it again.
    const { data: snags, error: snagError } = await admin
      .from("snagging_snags")
      .select(
        `*,
         area:snagging_areas(id, name),
         photos:snagging_snag_photos(id, snag_id, task_id, storage_path, media_type,
           bytes, width, height, gps_lat, gps_lng, taken_at, round_number, exif)`,
      )
      .eq("origin_task_id", id)
      .order("snag_code", { ascending: true });

    if (snagError) throw new Error(snagError.message);

    // §7/PDPL: nothing in the bucket is public, so every image the
    // reviewer sees is a short-lived signed URL minted per request.
    const withUrls = await signMediaPaths(admin, snags ?? []);

    const areas = ((task.areas ?? []) as Array<{ sort_order: number }>).slice().sort(
      (a, b) => a.sort_order - b.sort_order,
    );

    const approvals = ((task.approvals ?? []) as Array<{ created_at: string }>)
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const plans = await signMediaPaths(admin, task.floor_plans ?? []);

    return NextResponse.json({
      data: { ...task, areas, approvals, floor_plans: plans, snags: withUrls },
    });
  } catch (error) {
    console.error("Snagging task GET error:", error);
    return NextResponse.json({ error: "Failed to load inspection" }, { status: 500 });
  }
}

/** Schedule, assignment, and note edits. Status moves have their own routes. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = updateTaskSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();
    const { data: existing, error: loadError } = await admin
      .from("snagging_tasks")
      .select("id, status, locked")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!existing) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // BR-6: once the inspection is with the office, ops can no longer
    // reschedule or reassign it out from under the approval.
    if (existing.locked) {
      return NextResponse.json(
        { error: "This inspection is locked. Reject it back to the inspector to make changes." },
        { status: 409 },
      );
    }

    const { technician_ids: technicianIds, ...fields } = input;
    const updates = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from("snagging_tasks")
        .update(updates)
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
    }

    if (technicianIds) {
      // Replace the technician set wholesale; supervisors are held on
      // the task row and are not touched here.
      const { error: clearError } = await admin
        .from("snagging_task_assignees")
        .delete()
        .eq("task_id", id)
        .eq("role", "technician");
      if (clearError) throw new Error(clearError.message);

      if (technicianIds.length > 0) {
        const { error: insertError } = await admin.from("snagging_task_assignees").insert(
          technicianIds.map((userId) => ({
            task_id: id,
            user_id: userId,
            role: "technician" as const,
            assigned_by: profile.id,
          })),
        );
        if (insertError) throw new Error(insertError.message);
      }
    }

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "task_updated",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { ...updates, technician_ids: technicianIds },
    });

    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("Snagging task PATCH error:", error);
    return NextResponse.json({ error: "Failed to update inspection" }, { status: 500 });
  }
}

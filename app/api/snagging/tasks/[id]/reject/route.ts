import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { assertTransition, remediationDueAt } from "@/lib/server/snagging/workflow";
import { rejectTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

/**
 * Manager rejection with the three-tier branching from §5.3.
 *
 * The category is not cosmetic: it sets the remediation clock, and a
 * `critical` rejection means the evidence itself is unusable, so the
 * captured snags are unlocked for correction rather than left frozen.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.APPROVE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = rejectTaskSchema.safeParse(await req.json());
    if (!parsed.success) {
      // BR-5 lives in the schema: a rejection without a written
      // justification never reaches this point.
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { category, comment } = parsed.data;

    const admin = await createAdminServerClient();
    const { data: task, error: loadError } = await admin
      .from("snagging_tasks")
      .select("id, code, status, rejection_count")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!task) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    try {
      assertTransition(task.status as SnaggingTaskStatus, "rejected");
    } catch (transitionError) {
      return NextResponse.json({ error: (transitionError as Error).message }, { status: 409 });
    }

    const { error: updateError } = await admin
      .from("snagging_tasks")
      .update({
        status: "rejected",
        locked: false,
        rejection_category: category,
        rejection_reason: comment,
        rejection_count: (task.rejection_count ?? 0) + 1,
        remediation_due_at: remediationDueAt(category),
        approval_due_at: null,
      })
      .eq("id", id)
      .in("status", ["submitted", "in_review"]);

    if (updateError) throw new Error(updateError.message);

    // The inspector can only edit what is unlocked. Minor fixes are
    // made in the portal by ops, so those snags stay locked; the other
    // two categories send the record back to the device.
    if (category !== "minor") {
      const { error: unlockError } = await admin
        .from("snagging_snags")
        .update({ locked: false })
        .eq("origin_task_id", id);
      if (unlockError) throw new Error(unlockError.message);
    }

    const { error: actionError } = await admin.from("snagging_approvals").insert({
      task_id: id,
      action: "rejected",
      rejection_category: category,
      comment,
      actor_id: profile.id,
    });
    if (actionError) throw new Error(actionError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "task_rejected",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      justification: comment,
      payload: { code: task.code, category, attempt: (task.rejection_count ?? 0) + 1 },
    });

    return NextResponse.json({ data: { id, status: "rejected", category } });
  } catch (error) {
    console.error("Snagging reject error:", error);
    return NextResponse.json({ error: "Failed to reject inspection" }, { status: 500 });
  }
}

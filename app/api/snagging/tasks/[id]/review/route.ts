import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { assertTransition, isDesignatedApprovalManager } from "@/lib/server/snagging/workflow";
import { approveTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

/**
 * Start of review (FR-3.09, FR-6.01).
 *
 * Moves a submitted inspection into `in_review`, the intermediate state
 * the status flow requires between Submitted and Approved. In the
 * manager-owned model this is the approval manager picking the job up:
 * the same person who will then Approve or Reject it. It therefore checks
 * the same `approve` permission and the same designated-manager gate as
 * approval, and only advances a job that is currently `submitted`.
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
    const parsed = approveTaskSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: job, error: loadError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, approval_manager_id")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // FR-6.01 — reserved for the job's designated approval manager (or an admin).
    if (!isDesignatedApprovalManager(profile.id, job.approval_manager_id, isAdminUser(accessUser))) {
      return NextResponse.json(
        { error: "Only this inspection's approval manager can start its review." },
        { status: 403 },
      );
    }

    try {
      assertTransition(job.status as SnaggingTaskStatus, "in_review");
    } catch (transitionError) {
      return NextResponse.json({ error: (transitionError as Error).message }, { status: 409 });
    }

    const { error: updateError } = await admin
      .from("snagging_jobs")
      .update({ status: "in_review" })
      .eq("id", id)
      // Guard on the status we read so two managers opening the queue at
      // once cannot both advance it.
      .eq("status", "submitted");
    if (updateError) throw new Error(updateError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "task_in_review",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      justification: parsed.data.comment?.trim() || null,
      payload: { code: job.code },
    });

    return NextResponse.json({ data: { id, status: "in_review" } });
  } catch (error) {
    console.error("Snagging review error:", error);
    return NextResponse.json({ error: "Failed to start review" }, { status: 500 });
  }
}

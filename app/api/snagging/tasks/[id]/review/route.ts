import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { assertTransition, isDesignatedReviewer } from "@/lib/server/snagging/workflow";
import { approveTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

/**
 * Start of review (FR-3.09, FR-6.01).
 *
 * Moves a submitted inspection into `in_review` and records who picked it
 * up. This is the reviewer's hop, not the manager's: the job's named
 * reviewer takes it, checks the evidence, and hands it on with
 * /review/complete. Where no reviewer is named the approval manager owns
 * their own queue, so an unassigned job is never stuck waiting for an
 * assignment nobody made.
 *
 * Only advances a job that is currently `submitted`, and stamps
 * `review_started_at` so the queue can show how long it has been held.
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
      .select("id, code, status, approval_manager_id, reviewer_id")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // FR-6.01 — the named reviewer, or the approval manager where none is named.
    if (
      !isDesignatedReviewer(
        profile.id,
        job.reviewer_id,
        job.approval_manager_id,
        isAdminUser(accessUser),
      )
    ) {
      return NextResponse.json(
        { error: "Only this inspection's reviewer or approval manager can start its review." },
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
      .update({
        status: "in_review",
        review_started_at: new Date().toISOString(),
        // Picking a job up claims it, so an unassigned queue does not stay
        // unassigned once somebody has actually started on it.
        reviewer_id: job.reviewer_id ?? profile.id,
      })
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
      // FR-6.04 — the transition, not just its name.
      payload: {
        code: job.code,
        from_status: job.status,
        to_status: "in_review",
        reviewer_id: job.reviewer_id ?? profile.id,
      },
    });

    return NextResponse.json({ data: { id, status: "in_review" } });
  } catch (error) {
    console.error("Snagging review error:", error);
    return NextResponse.json({ error: "Failed to start review" }, { status: 500 });
  }
}

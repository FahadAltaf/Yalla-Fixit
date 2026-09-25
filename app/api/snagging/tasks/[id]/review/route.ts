import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAuditBatch } from "@/lib/server/snagging/audit";
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
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = approveTaskSchema.safeParse(body);
    /*
      Start AND complete in one step, for someone reviewing a job they will
      also decide (the approval manager, with no separate reviewer). That
      used to be two requests one after another -- start, then complete --
      before the Approve button could appear.
    */
    const completeToo = body?.complete_review === true;
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

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("snagging_jobs")
      .update({
        status: "in_review",
        review_started_at: now,
        // Completed as well, when asked for (see completeToo).
        ...(completeToo ? { reviewed_at: now } : {}),
        // Picking a job up claims it, so an unassigned queue does not stay
        // unassigned once somebody has actually started on it.
        reviewer_id: job.reviewer_id ?? profile.id,
      })
      .eq("id", id)
      // Guard on the status we read so two managers opening the queue at
      // once cannot both advance it.
      .eq("status", "submitted");
    if (updateError) throw new Error(updateError.message);

    const started = {
      entityType: "task" as const,
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
    };
    // Both entries in one write when the review was completed too.
    await recordAuditBatch(
      admin,
      completeToo
        ? [
            started,
            {
              ...started,
              eventType: "review_completed",
              payload: {
                code: job.code,
                reviewer_id: job.reviewer_id ?? profile.id,
                approval_manager_id: job.approval_manager_id,
              },
            },
          ]
        : [started],
    );

    return NextResponse.json({
      data: { id, status: "in_review", ...(completeToo ? { reviewed_at: now } : {}) },
    });
  } catch (error) {
    console.error("Snagging review error:", error);
    return NextResponse.json({ error: "Failed to start review" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { isDesignatedReviewer } from "@/lib/server/snagging/workflow";
import { completeReviewSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The reviewer handing the inspection to the approval manager (FR-6.01).
 *
 * This is the second hop in the routing chain and the only thing that opens
 * the decision: `approve` and `reject` both refuse a job whose `reviewed_at`
 * is null. The status does not move -- `in_review` covers the reviewer's
 * pass and the manager's decision alike -- so nothing downstream that
 * filters on status has to learn a new value.
 *
 * Idempotent: completing an already-completed review returns the existing
 * timestamp rather than moving it, so a double-click cannot rewrite when the
 * review actually finished.
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
    const parsed = completeReviewSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: job, error: loadError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, reviewer_id, approval_manager_id, reviewed_at")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    if (
      !isDesignatedReviewer(
        profile.id,
        job.reviewer_id,
        job.approval_manager_id,
        isAdminUser(accessUser),
      )
    ) {
      return NextResponse.json(
        { error: "Only this inspection's reviewer can complete its review." },
        { status: 403 },
      );
    }

    if (job.status !== "in_review") {
      return NextResponse.json(
        { error: `Review can only be completed on an inspection that is in review, not ${job.status}.` },
        { status: 409 },
      );
    }

    if (job.reviewed_at) {
      return NextResponse.json({
        data: { id, status: job.status, reviewed_at: job.reviewed_at, already: true },
      });
    }

    const reviewedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("snagging_jobs")
      .update({ reviewed_at: reviewedAt })
      .eq("id", id)
      .eq("status", "in_review")
      // Only the first completion writes; a concurrent second finds the
      // column already set and matches nothing.
      .is("reviewed_at", null);
    if (updateError) throw new Error(updateError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "review_completed",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      justification: parsed.data.comment?.trim() || null,
      payload: {
        code: job.code,
        reviewer_id: job.reviewer_id,
        approval_manager_id: job.approval_manager_id,
      },
    });

    return NextResponse.json({ data: { id, status: job.status, reviewed_at: reviewedAt } });
  } catch (error) {
    console.error("Snagging review complete error:", error);
    return NextResponse.json({ error: "Failed to complete the review" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { issueReportVersion } from "@/lib/server/snagging/report-versions";
import {
  assertTransition,
  isDesignatedApprovalManager,
  isReviewComplete,
} from "@/lib/server/snagging/workflow";
import { approveTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

/**
 * Manager approval (FR-4.02, BR-4).
 *
 * Approval is the only gate to client delivery and has no bypass, so
 * the permission checked here is the dedicated `approve` action rather
 * than `edit`.
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
      .select("id, code, status, round_number, approval_manager_id, visit_type, reviewed_at")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // FR-6.01 — only the job's designated approval manager (or an admin) may
    // approve. The `approve` permission alone is not enough.
    if (!isDesignatedApprovalManager(profile.id, job.approval_manager_id, isAdminUser(accessUser))) {
      return NextResponse.json(
        { error: "Only this inspection's approval manager can approve it." },
        { status: 403 },
      );
    }

    /*
      FR-6.01 — the decision comes after the review, not instead of it.

      The state machine already refuses submitted -> approved; this is the
      second half of the same rule, because `in_review` spans both the
      reviewer's pass and the manager's decision. Without it a manager could
      start a review and approve in the same breath, which is the bypass the
      two-hop routing exists to prevent.
    */
    if (!isReviewComplete(job.reviewed_at)) {
      return NextResponse.json(
        {
          error:
            "This inspection has not been reviewed yet. The reviewer must complete their review before it can be approved.",
        },
        { status: 409 },
      );
    }

    try {
      assertTransition(job.status as SnaggingTaskStatus, "approved");
    } catch (transitionError) {
      return NextResponse.json(
        { error: (transitionError as Error).message },
        { status: 409 },
      );
    }

    const approvedAt = new Date().toISOString();

    const { error: updateError } = await admin
      .from("snagging_jobs")
      .update({
        status: "approved",
        approved_at: approvedAt,
        locked: true,
      })
      // Guarding on the status we read makes the transition safe against
      // two managers hitting approve at the same moment.
      .eq("id", id)
      // Guarding on the status we read makes the transition safe against two
      // managers hitting approve at the same moment; a second request finds
      // the row already moved and changes nothing.
      .eq("status", "in_review");

    if (updateError) throw new Error(updateError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "task_approved",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      justification: parsed.data.comment?.trim() || null,
      payload: { code: job.code, from_status: job.status, to_status: "approved" },
    });

    /*
      Module 9 — approving work reissues the client's report.

      An additional visit does not get a report of its own; its snags join
      the original inspection's, which goes out as a new version. So
      approving a visit mints V2, V3 … against the ORIGINAL, and approving
      the original inspection mints its V1.

      A de-snag round mints nothing: its rows are working copies whose
      verdicts write through to the originals, so it changes the defects'
      status rather than the report's contents.
    */
    let reportVersion: { version: number; snagCount: number; created: boolean } | null = null;
    if (job.visit_type !== "desnag") {
      const isVisit = job.visit_type === "additional";
      try {
        reportVersion = await issueReportVersion(admin, {
          jobId: id,
          sourceVisitId: isVisit ? id : null,
          generatedBy: profile.id,
          reason: isVisit
            ? `Additional visit ${job.code} approved`
            : "Original inspection approved",
        });
      } catch (versionError) {
        // The approval is already committed and must not be undone by a
        // bookkeeping failure; the version can be reissued on delivery.
        console.error("Report version could not be issued:", versionError);
      }

      if (reportVersion?.created) {
        await recordAudit(admin, {
          entityType: "task",
          entityId: id,
          taskId: id,
          eventType: "report_version_created",
          actorId: profile.id,
          actorLabel: profile.full_name ?? profile.email,
          payload: {
            code: job.code,
            version: reportVersion.version,
            snag_count: reportVersion.snagCount,
            source_visit_id: isVisit ? id : null,
          },
        });
      }

      if (isVisit) {
        await recordAudit(admin, {
          entityType: "task",
          entityId: id,
          taskId: id,
          eventType: "additional_visit_merged",
          actorId: profile.id,
          actorLabel: profile.full_name ?? profile.email,
          payload: { code: job.code, report_version: reportVersion?.version ?? null },
        });
      }
    }

    // The branded report queue lives outside the lean schema, so no
    // report row is created here; the response keeps its shape with a
    // null report_id.
    return NextResponse.json({
      data: {
        id,
        status: "approved",
        report_id: null,
        report_version: reportVersion?.version ?? null,
      },
    });
  } catch (error) {
    console.error("Snagging approve error:", error);
    return NextResponse.json({ error: "Failed to approve inspection" }, { status: 500 });
  }
}

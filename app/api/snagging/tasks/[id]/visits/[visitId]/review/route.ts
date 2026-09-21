import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import { generateReportPdf } from "@/lib/server/snagging/report-generate";
import { issueReportVersion } from "@/lib/server/snagging/report-versions";
import { isDesignatedApprovalManager } from "@/lib/server/snagging/workflow";
import { ActionType, ResourceType } from "@/types/types";

const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({
    decision: z.literal("send_back"),
    reason: z.string().trim().min(3, "Say what needs doing").max(2000),
  }),
]);

/**
 * The manager's decision on a submitted additional visit (decided
 * 2026-09-18: the manager reviews before the client sees it).
 *
 * Approve: the visit is complete, and the client's ONE report is reissued
 * as a new version carrying what the visit found (change 28 — "new snags
 * join the original report"). Earlier versions stay available.
 *
 * Send back: the visit reopens on the phone with the reason attached, and
 * its own snags unlock so they can be corrected. The earlier visit's
 * findings stay locked throughout — they are already in the client's
 * hands.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; visitId: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.APPROVE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = reviewSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid decision" },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const { id, visitId } = await ctx.params;
    const admin = await createAdminServerClient();
    const family = await loadJobFamily(admin, id);

    const { data: visit, error: visitError } = await admin
      .from("snagging_job_visits")
      .select("id, job_id, visit_number, status")
      .eq("id", visitId)
      .maybeSingle();
    if (visitError) throw new Error(visitError.message);
    if (!visit || visit.job_id !== family.rootId) {
      return NextResponse.json({ error: "Visit not found on this job" }, { status: 404 });
    }
    if (visit.status !== "submitted") {
      return NextResponse.json(
        { error: `Visit ${visit.visit_number} is ${visit.status}, so there is nothing to review.` },
        { status: 409 },
      );
    }

    const { data: job, error: jobError } = await admin
      .from("snagging_jobs")
      .select("id, code, approval_manager_id")
      .eq("id", visit.job_id as string)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // The same person who signs off the inspection signs off its visits.
    if (!isDesignatedApprovalManager(profile.id, job.approval_manager_id, isAdminUser(accessUser))) {
      return NextResponse.json(
        { error: "Only this job's approval manager or an admin can review its visits." },
        { status: 403 },
      );
    }

    const now = new Date().toISOString();

    if (input.decision === "send_back") {
      const { error } = await admin
        .from("snagging_job_visits")
        .update({
          status: "in_progress",
          review_note: input.reason,
          reviewed_by: profile.id,
          reviewed_at: now,
          updated_at: now,
        })
        .eq("id", visitId)
        .eq("status", "submitted");
      if (error) throw new Error(error.message);

      // Only this visit's findings reopen; the approved ones stay put.
      const { error: unlockError } = await admin
        .from("snagging_snags")
        .update({ locked: false })
        .eq("job_id", job.id)
        .eq("visit_id", visitId);
      if (unlockError) throw new Error(unlockError.message);

      await recordAudit(admin, {
        entityType: "task",
        entityId: visitId,
        taskId: job.id,
        eventType: "visit_sent_back",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        justification: input.reason,
        payload: { code: job.code, visit_number: visit.visit_number },
      });

      return NextResponse.json({ data: { status: "in_progress" } });
    }

    // Approve.
    const { error: approveError } = await admin
      .from("snagging_job_visits")
      .update({
        status: "completed",
        completed_at: now,
        reviewed_by: profile.id,
        reviewed_at: now,
        review_note: null,
        updated_at: now,
      })
      .eq("id", visitId)
      .eq("status", "submitted");
    if (approveError) throw new Error(approveError.message);

    /*
      The client's report, reissued with the visit's findings in it.

      Awaited, like the inspection's own approval, so the manager is told
      whether the document actually exists. A failure never undoes the
      approval, which is already committed; it is reported and can be
      regenerated from the versions list.
    */
    let generation:
      | { status: "generated" | "failed"; version: number; error?: string }
      | null = null;
    try {
      const version = await issueReportVersion(admin, {
        jobId: job.id,
        sourceVisitId: visitId,
        generatedBy: profile.id,
        reason: `Additional visit ${visit.visit_number} approved`,
      });
      if (version) {
        const generated = await generateReportPdf(admin, version.id, {
          actorId: profile.id,
          actorLabel: profile.full_name ?? profile.email,
        });
        generation = generated.ok
          ? { status: "generated", version: version.version }
          : { status: "failed", version: version.version, error: generated.error };
      }
    } catch (versionError) {
      console.error("Visit report version could not be issued:", versionError);
      generation = {
        status: "failed",
        version: 0,
        error: versionError instanceof Error ? versionError.message : "Report generation failed",
      };
    }

    await recordAudit(admin, {
      entityType: "task",
      entityId: visitId,
      taskId: job.id,
      eventType: "visit_approved",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        code: job.code,
        visit_number: visit.visit_number,
        report_version: generation?.version ?? null,
      },
    });

    return NextResponse.json({ data: { status: "completed", generation } });
  } catch (error) {
    console.error("Visit review POST error:", error);
    return NextResponse.json({ error: "Failed to record the review" }, { status: 500 });
  }
}

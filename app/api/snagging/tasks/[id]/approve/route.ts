import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { assertTransition, isDesignatedApprovalManager } from "@/lib/server/snagging/workflow";
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
      .select("id, code, status, round_number, approval_manager_id")
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
      .in("status", ["submitted", "in_review"]);

    if (updateError) throw new Error(updateError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "task_approved",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      justification: parsed.data.comment?.trim() || null,
      payload: { code: job.code },
    });

    // The branded report queue lives outside the lean schema, so no
    // report row is created here; the response keeps its shape with a
    // null report_id.
    return NextResponse.json({ data: { id, status: "approved", report_id: null } });
  } catch (error) {
    console.error("Snagging approve error:", error);
    return NextResponse.json({ error: "Failed to approve inspection" }, { status: 500 });
  }
}

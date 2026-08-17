import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { assertTransition } from "@/lib/server/snagging/workflow";
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
    const { data: task, error: loadError } = await admin
      .from("snagging_tasks")
      .select("id, code, status, property_id, round_number, approval_manager_id")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!task) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    try {
      assertTransition(task.status as SnaggingTaskStatus, "approved");
    } catch (transitionError) {
      return NextResponse.json(
        { error: (transitionError as Error).message },
        { status: 409 },
      );
    }

    const approvedAt = new Date().toISOString();

    const { error: updateError } = await admin
      .from("snagging_tasks")
      .update({
        status: "approved",
        approved_at: approvedAt,
        approved_by: profile.id,
        locked: true,
        rejection_category: null,
      })
      // Guarding on the status we read makes the transition safe against
      // two managers hitting approve at the same moment.
      .eq("id", id)
      .in("status", ["submitted", "in_review"]);

    if (updateError) throw new Error(updateError.message);

    const { error: actionError } = await admin.from("snagging_approvals").insert({
      task_id: id,
      action: "approved",
      comment: parsed.data.comment?.trim() || null,
      actor_id: profile.id,
    });
    if (actionError) throw new Error(actionError.message);

    // FR-5.01: the branded report is generated off the back of approval.
    // The row is queued here and picked up by the generator; delivery
    // (FR-5.04) is a separate, explicit action by ops.
    const { data: report, error: reportError } = await admin
      .from("snagging_reports")
      .insert({
        task_id: id,
        property_id: task.property_id,
        round_number: task.round_number,
        report_type: task.round_number > 1 ? "delta" : "full",
        status: "queued",
      })
      .select("id")
      .single();
    if (reportError) throw new Error(reportError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "task_approved",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      justification: parsed.data.comment?.trim() || null,
      payload: { code: task.code, report_id: report.id },
    });

    return NextResponse.json({ data: { id, status: "approved", report_id: report.id } });
  } catch (error) {
    console.error("Snagging approve error:", error);
    return NextResponse.json({ error: "Failed to approve inspection" }, { status: 500 });
  }
}

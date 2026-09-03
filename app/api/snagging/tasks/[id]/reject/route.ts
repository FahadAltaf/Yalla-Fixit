import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { emailService } from "@/lib/email-service";
import { recordAudit } from "@/lib/server/snagging/audit";
import { REJECTION_LABELS } from "@/lib/server/snagging/workflow";
import { assertTransition, isDesignatedApprovalManager, remediationDueAt } from "@/lib/server/snagging/workflow";
import { rejectTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

/**
 * Manager rejection (§5.3).
 *
 * The written reason is the durable record of what went wrong (BR-5).
 * The category is persisted and drives the remediation clock
 * (remediation_due_at) and the rejection tally (rejection_count). A
 * rejection also unlocks the captured snags so the inspector can correct
 * them, unless it is only a `minor` fix ops can make in the portal.
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
    const { data: job, error: loadError } = await admin
      .from("snagging_jobs")
      .select(
        "id, code, status, rejection_count, approval_manager_id, inspector_id, unit_label, building_name",
      )
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // FR-6.01 — rejection is a manager act, reserved for the job's designated
    // approval manager (or an admin).
    if (!isDesignatedApprovalManager(profile.id, job.approval_manager_id, isAdminUser(accessUser))) {
      return NextResponse.json(
        { error: "Only this inspection's approval manager can reject it." },
        { status: 403 },
      );
    }

    try {
      assertTransition(job.status as SnaggingTaskStatus, "rejected");
    } catch (transitionError) {
      return NextResponse.json({ error: (transitionError as Error).message }, { status: 409 });
    }

    // §5.3 — the category sets the remediation clock and adds to the tally,
    // so the deadline the inspector sees and the "how many times" figure
    // both come from here rather than being dropped.
    const remediationDeadline = remediationDueAt(category);

    const { error: updateError } = await admin
      .from("snagging_jobs")
      .update({
        status: "rejected",
        locked: false,
        rejection_reason: comment,
        rejection_category: category,
        remediation_due_at: remediationDeadline,
        rejection_count: (job.rejection_count ?? 0) + 1,
      })
      .eq("id", id)
      // Same optimistic guard as approval: whichever decision lands first wins.
      .eq("status", "in_review");

    if (updateError) throw new Error(updateError.message);

    // The inspector can only edit what is unlocked. Minor fixes are
    // made in the portal by ops, so those snags stay locked; the other
    // two categories send the record back to the device.
    if (category !== "minor") {
      const { error: unlockError } = await admin
        .from("snagging_snags")
        .update({ locked: false })
        .eq("job_id", id);
      if (unlockError) throw new Error(unlockError.message);
    }

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "task_rejected",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      justification: comment,
      payload: {
        code: job.code,
        category,
        from_status: job.status,
        to_status: "rejected",
        remediation_due_at: remediationDeadline,
      },
    });

    /*
      FR-6.02 — tell the inspector, don't wait for them to notice.

      Best-effort and last: the rejection is already committed and audited,
      and a mail failure must not roll it back or fail the manager's request.
    */
    let notified = false;
    if (job.inspector_id) {
      const { data: inspector } = await admin
        .from("user_profile")
        .select("email")
        .eq("id", job.inspector_id)
        .maybeSingle();

      if (inspector?.email) {
        try {
          await emailService.sendSnaggingRejectionEmail({
            to: inspector.email,
            code: job.code,
            unit:
              [job.unit_label, job.building_name].filter(Boolean).join(", ") || job.code,
            categoryLabel: REJECTION_LABELS[category].title,
            remediation: REJECTION_LABELS[category].remediation,
            reason: comment,
            dueAt: remediationDeadline,
            jobUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/snagging/${id}`,
          });
          notified = true;
        } catch (emailError) {
          console.error("Rejection email failed:", job.code, emailError);
        }
      }
    }

    return NextResponse.json({
      data: {
        id,
        status: "rejected",
        category,
        remediation_due_at: remediationDeadline,
        inspector_notified: notified,
      },
    });
  } catch (error) {
    console.error("Snagging reject error:", error);
    return NextResponse.json({ error: "Failed to reject inspection" }, { status: 500 });
  }
}

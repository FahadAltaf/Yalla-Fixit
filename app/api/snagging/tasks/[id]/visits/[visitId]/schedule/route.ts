import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { assertVisitQuotationApproved } from "@/lib/server/snagging/visit-quotation";
import { scheduleVisitSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * FR-9.04 — books an additional visit, once it is paid for.
 *
 * The visit already exists as a draft with its outstanding coverage
 * loaded; this is the step that commits a date, an inspector and the
 * client's money. It is a separate endpoint precisely so the quotation
 * check has something to check: a quotation for the visit cannot be
 * raised until the visit exists.
 *
 * The gate is here rather than in the UI because a disabled button is not
 * a control. Anything that can reach the API — a stale tab, a retry, a
 * script — bypasses the button and would otherwise book unpaid work.
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
    // Scheduling changes an existing job, so it needs the edit right
    // rather than the create right that raising the request needed.
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, visitId } = await ctx.params;
    const parsed = scheduleVisitSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    const { data: visit, error: visitError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, visit_type, parent_job_id, inspector_id")
      .eq("id", visitId)
      .maybeSingle();
    if (visitError) throw new Error(visitError.message);
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    /*
      The visit must belong to the inspection in the URL. Without this a
      caller could schedule any visit through any inspection's route,
      which would pass every other check here.
    */
    if (visit.parent_job_id !== id) {
      return NextResponse.json(
        { error: "That visit does not belong to this inspection" },
        { status: 404 },
      );
    }

    // De-snag rounds are not chargeable and are not booked through here.
    if (visit.visit_type !== "additional") {
      return NextResponse.json(
        { error: "Only an additional visit is scheduled through this route" },
        { status: 409 },
      );
    }

    if (!["draft", "assigned"].includes(visit.status as string)) {
      return NextResponse.json(
        { error: `This visit is ${visit.status} and can no longer be rescheduled here` },
        { status: 409 },
      );
    }

    // FR-9.04 — the whole point of this endpoint.
    const gate = await assertVisitQuotationApproved(admin, visitId);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.reason }, { status: 409 });
    }

    const inspectorId = input.inspector_id ?? visit.inspector_id ?? null;

    const { error: updateError } = await admin
      .from("snagging_jobs")
      .update({
        status: "assigned",
        scheduled_date: input.scheduled_date,
        appointment_at: input.appointment_at ?? null,
        inspector_id: inspectorId,
        // The agreed price, fixed at the moment it was agreed.
        visit_charge: gate.total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId);
    if (updateError) throw new Error(updateError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: visitId,
      taskId: visitId,
      eventType: "additional_visit_scheduled",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        code: visit.code,
        scheduled_date: input.scheduled_date,
        appointment_at: input.appointment_at ?? null,
        quotation_id: gate.quotationId,
        visit_charge: gate.total,
      },
    });

    if (inspectorId && inspectorId !== visit.inspector_id) {
      await recordAudit(admin, {
        entityType: "task",
        entityId: visitId,
        taskId: visitId,
        eventType: "additional_visit_inspector_assigned",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: { code: visit.code, inspector_id: inspectorId },
      });
    }

    return NextResponse.json({
      data: {
        id: visitId,
        code: visit.code,
        status: "assigned",
        scheduled_date: input.scheduled_date,
        quotation_id: gate.quotationId,
      },
    });
  } catch (error) {
    console.error("Additional visit schedule error:", error);
    return NextResponse.json({ error: "Failed to schedule the additional visit" }, { status: 500 });
  }
}

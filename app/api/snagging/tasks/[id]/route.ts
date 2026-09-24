import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { loadJobCore } from "@/lib/server/snagging/job-detail-sections";
import { assertTransition } from "@/lib/server/snagging/workflow";
import { updateTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

/**
 * One inspection's core record. The lean schema keeps client, sign-off and
 * the inspector on the job row; this route reassembles the `property`,
 * `assignees` and `submissions` shapes the UI already reads. The other
 * sections of the job detail are sibling routes (see
 * lib/server/snagging/job-detail-sections.ts).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    // const { profile, accessUser } = await getRequestUserAccess(req);
    // if (!profile || !accessUser) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }
    // if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
    //   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    /*
      The job itself, and only that -- the page header, the Setup tab, the
      property and sign-off. The checklist, the snags, the floor plans, the
      visit status and the de-snag quotation are their own routes now, so
      this answers without waiting on family resolution or photo signing.
      snaggingService.getTask still returns the combined record for the
      pages that want all of it, by calling them together.
    */
    const job = await loadJobCore(admin, id);
    if (!job)
      return NextResponse.json(
        { error: "Inspection not found" },
        { status: 404 },
      );

    return NextResponse.json({ data: job });
  } catch (error) {
    console.error("Snagging task GET error:", error);
    return NextResponse.json(
      { error: "Failed to load inspection" },
      { status: 500 },
    );
  }
}

/** Schedule, assignment, and note edits. Status moves have their own routes. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = updateTaskSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();
    const { data: existing, error: loadError } = await admin
      .from("snagging_jobs")
      .select(
        "id, code, status, locked, inspector_id, approval_manager_id, reviewer_id, scheduled_date, appointment_at, parent_job_id",
      )
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!existing)
      return NextResponse.json(
        { error: "Inspection not found" },
        { status: 404 },
      );

    if (existing.locked) {
      return NextResponse.json(
        {
          error:
            "This inspection is locked. Reject it back to the inspector to make changes.",
        },
        { status: 409 },
      );
    }

    // Only fields that still exist on the job map through.
    const updates: Record<string, unknown> = {};
    // Appointment carries date + time (FR-3.02); scheduled_date stays in step
    // for the list/mobile, derived from the appointment when only it is given.
    if (input.appointment_at !== undefined) {
      updates.appointment_at = input.appointment_at;
      if (input.scheduled_date === undefined) {
        updates.scheduled_date = input.appointment_at
          ? input.appointment_at.slice(0, 10)
          : null;
      }
    }
    if (input.scheduled_date !== undefined)
      updates.scheduled_date = input.scheduled_date;
    if (input.approval_manager_id !== undefined)
      updates.approval_manager_id = input.approval_manager_id;
    // FR-6.01 — who checks the work before the manager decides.
    if (input.reviewer_id !== undefined)
      updates.reviewer_id = input.reviewer_id;
    // Site contacts (FR-3.03), editable after creation.
    if (input.developer_contact_name !== undefined)
      updates.developer_contact_name = input.developer_contact_name;
    if (input.developer_contact_phone !== undefined)
      updates.developer_contact_phone = input.developer_contact_phone;
    if (input.client_contact_name !== undefined)
      updates.client_contact_name = input.client_contact_name;
    if (input.client_contact_phone !== undefined)
      updates.client_contact_phone = input.client_contact_phone;
    if (input.notes !== undefined) updates.notes = input.notes;
    // Status moves normally go through the dedicated action routes (submit,
    // approve, reject, deliver). The only status change this generic edit
    // still serves is cancellation, so any status it is asked to write must
    // be a legal transition from the current one — a PATCH cannot skip or
    // reverse the state machine. (The schema already caps the field to
    // draft/assigned/cancelled, so the approval chain is unreachable here.)
    if (input.status !== undefined && input.status !== existing.status) {
      try {
        assertTransition(
          existing.status as SnaggingTaskStatus,
          input.status as SnaggingTaskStatus,
        );
      } catch (transitionError) {
        return NextResponse.json(
          { error: (transitionError as Error).message },
          { status: 409 },
        );
      }
      updates.status = input.status;
    }

    /*
      Inspector assignment (FR-3.08), now a set rather than a person.

      Several inspectors work one job and none is senior to another, so
      the whole selection is kept in snagging_job_inspectors. The job's own
      inspector_id stays as the first of them: submission, the report cover
      and the app's existing sync all still read it, and it is a compat
      anchor now rather than a rank above the others.
    */
    let assignedInspectorId: string | null | undefined;
    let assignedInspectorIds: string[] | undefined;
    if (input.technician_ids !== undefined) {
      assignedInspectorIds = [...new Set(input.technician_ids)];
      assignedInspectorId = assignedInspectorIds[0] ?? null;
      updates.inspector_id = assignedInspectorId;
    }

    // Assigning (or changing to) a real inspector is gated server-side, so a
    // direct PATCH cannot bypass the quotation approval the UI enforces.
    const assigningInspector =
      assignedInspectorId != null &&
      assignedInspectorId !== existing.inspector_id;
    if (assigningInspector) {
      // 1. The client must have approved the quotation — unless this is a child
      //    job (de-snag round / additional visit), whose parent already cleared
      //    the gate and which is created assigned by design.
      const isChild = existing.parent_job_id != null;
      if (!isChild) {
        /*
          The inspection's quotation only, and the newest of them. This
          was a bare maybeSingle(), which errors the moment a job has two
          quotations — and a visit's quotation is a second one — so
          raising a visit quotation silently blocked inspector assignment.
        */
        const { data: quote } = await admin
          .from("snagging_quotations")
          .select("status")
          .eq("job_id", id)
          .neq("quote_kind", "visit")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!quote || quote.status !== "approved") {
          return NextResponse.json(
            {
              error:
                "Assign an inspector only after the client approves the quotation.",
            },
            { status: 409 },
          );
        }
      }
      // 2. An approval manager is mandatory (already on the job, or set now).
      const managerId =
        input.approval_manager_id !== undefined
          ? input.approval_manager_id
          : existing.approval_manager_id;
      if (!managerId) {
        return NextResponse.json(
          {
            error: "Select an approval manager before assigning an inspector.",
          },
          { status: 400 },
        );
      }
      // 3. No double-booking: the inspector must be free on the appointment day.
      const day =
        (updates.scheduled_date as string | null | undefined) ??
        existing.scheduled_date ??
        null;
      if (day) {
        const { data: clashes, error: clashError } = await admin
          .from("snagging_jobs")
          .select("code")
          .eq("inspector_id", assignedInspectorId)
          .eq("scheduled_date", day)
          .in("status", ["assigned", "in_progress"])
          .neq("id", id)
          .limit(1);
        if (clashError) throw new Error(clashError.message);
        if (clashes && clashes.length > 0) {
          return NextResponse.json(
            {
              error: `That inspector is already on inspection ${clashes[0].code} on ${day}. Pick another inspector or change the date.`,
            },
            { status: 409 },
          );
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from("snagging_jobs")
        .update(updates)
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
    }

    /*
      The job's inspectors, replaced wholesale.

      Delete-then-insert rather than a diff: the set is small, the UI sends
      the complete selection every time, and a diff would have to reason
      about a row somebody removed in another tab. Guarded on the table
      existing so this route still works where 20260923100000 has not run.
    */
    if (assignedInspectorIds !== undefined) {
      const { error: clearError } = await admin
        .from("snagging_job_inspectors")
        .delete()
        .eq("job_id", id);

      // 42P01 is "undefined table": the migration has not run here yet.
      if (clearError && clearError.code !== "42P01") {
        throw new Error(clearError.message);
      }

      if (!clearError && assignedInspectorIds.length > 0) {
        const { error: insertError } = await admin
          .from("snagging_job_inspectors")
          .insert(
            assignedInspectorIds.map((inspectorId) => ({
              job_id: id,
              inspector_id: inspectorId,
            })),
          );
        if (insertError) throw new Error(insertError.message);
      }
    }

    if (assigningInspector) {
      await recordAudit(admin, {
        entityType: "task",
        entityId: id,
        taskId: id,
        eventType: "inspector_assigned",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: {
          inspector_id: assignedInspectorId,
          old_value: existing.inspector_id,
          new_value: assignedInspectorId,
          code: existing.code,
        },
      });
    }

    /*
      FR-6.04 — reassignment is a change to who is accountable, and it was
      the one edit on this route that left no trace. Both sides of the
      review chain are recorded with their old and new holder, so "who was
      the approval manager when this was signed off" has an answer.
    */
    const reassignments: Array<{
      event: string;
      from: string | null;
      to: string | null;
    }> = [];
    if (
      input.approval_manager_id !== undefined &&
      input.approval_manager_id !== existing.approval_manager_id
    ) {
      reassignments.push({
        event: "approval_manager_assigned",
        from: existing.approval_manager_id,
        to: input.approval_manager_id,
      });
    }
    if (
      input.reviewer_id !== undefined &&
      input.reviewer_id !== existing.reviewer_id
    ) {
      reassignments.push({
        event: "reviewer_assigned",
        from: existing.reviewer_id,
        to: input.reviewer_id,
      });
    }

    for (const change of reassignments) {
      await recordAudit(admin, {
        entityType: "task",
        entityId: id,
        taskId: id,
        eventType: change.event,
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: {
          code: existing.code,
          old_value: change.from,
          new_value: change.to,
        },
      });
    }

    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("Snagging task PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update inspection" },
      { status: 500 },
    );
  }
}

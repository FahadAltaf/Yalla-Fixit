import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { signMediaPaths } from "@/lib/server/snagging/media";
import { assertTransition } from "@/lib/server/snagging/workflow";
import { updateTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

/**
 * One inspection with everything the detail screen and the approval
 * review need. The lean schema keeps client, floor plan, sign-off and the
 * inspector on the job row; this route reassembles the `property`,
 * `assignees`, `floor_plans` and `submissions` shapes the UI already reads.
 */
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    const { data: job, error } = await admin
      .from("snagging_jobs")
      .select(
        `*,
         client:client_id(id, name, email, phone, company),
         inspector:inspector_id(id, full_name, email, profile_image),
         manager:approval_manager_id(id, full_name, email),
         property_record:property_id(*),
         areas:snagging_areas(*)`,
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    const { data: checklist, error: checklistError } = await admin
      .from("snagging_job_checklist")
      .select("id, code, group_name, label, mandatory, status, reason, sort_order")
      .eq("job_id", id)
      .order("sort_order", { ascending: true });
    if (checklistError) throw new Error(checklistError.message);

    const { data: snagRows, error: snagError } = await admin
      .from("snagging_snags")
      .select(
        `*,
         area:snagging_areas(id, name),
         photos:snagging_snag_photos(id, snag_id, job_id, storage_path, media_type,
           bytes, width, height, taken_at, round_number, gps_lat, gps_lng, exif)`,
      )
      .eq("job_id", id)
      .order("snag_code", { ascending: true });
    if (snagError) throw new Error(snagError.message);

    const signedSnags = await signMediaPaths(admin, snagRows ?? []);
    // Keep the pre-merge keys the UI reads (origin_task_id, photo.task_id).
    const snags = signedSnags.map((snag) => {
      const s = snag as Record<string, unknown> & { photos?: Array<Record<string, unknown>> };
      return {
        ...s,
        origin_task_id: s.job_id,
        photos: (s.photos ?? []).map((p) => ({ ...p, task_id: p.job_id })),
      };
    });

    const areas = ((job.areas ?? []) as Array<{ sort_order: number }>)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);

    const client = firstOf(job.client as { name?: string; email?: string; phone?: string } | null);
    const inspector = firstOf(
      job.inspector as { id?: string; full_name?: string; email?: string; profile_image?: string } | null,
    );

    // The property record is canonical now (BR-1); fall back to the job's
    // denormalised snapshot for any job that predates the property link.
    const rec = firstOf(job.property_record as Record<string, unknown> | null) as
      | Record<string, unknown>
      | null;
    const pick = (key: string) => (rec ? rec[key] : (job as Record<string, unknown>)[key]);
    const property = {
      id: (rec?.id as string | undefined) ?? job.property_id ?? job.client_id,
      client_name: client?.name ?? "",
      client_email: client?.email ?? null,
      client_phone: client?.phone ?? null,
      unit_label: pick("unit_label"),
      building_name: pick("building_name"),
      community: pick("community"),
      city: "Dubai",
      property_type: pick("property_type"),
      developer_name: pick("developer_name"),
      // Full attributes for the job detail / property edit (portal only).
      bedrooms: pick("bedrooms") ?? null,
      built_up_area_sqft: pick("built_up_area_sqft") ?? null,
      plot_area_sqft: pick("plot_area_sqft") ?? null,
      external_areas_in_scope: pick("external_areas_in_scope") ?? false,
      floors: pick("floors") ?? null,
      location_lat: pick("location_lat") ?? null,
      location_lng: pick("location_lng") ?? null,
      title_deed_path: pick("title_deed_path") ?? null,
      noc_required: pick("noc_required") ?? false,
      noc_path: pick("noc_path") ?? null,
    };

    // Sign the property's NOC and title deed (FR-3.04 / FR-1.09) so the job can
    // show "on file" with a view/download link — reusing the existing
    // property-level document, never a second upload.
    const [nocSigned, deedSigned] = await Promise.all([
      property.noc_path
        ? signMediaPaths(admin, [{ id: "noc", storage_path: property.noc_path as string }])
        : Promise.resolve([]),
      property.title_deed_path
        ? signMediaPaths(admin, [{ id: "deed", storage_path: property.title_deed_path as string }])
        : Promise.resolve([]),
    ]);
    const propertyWithDocs = {
      ...property,
      noc_url: (nocSigned[0] as { signed_url?: string } | undefined)?.signed_url ?? null,
      title_deed_url: (deedSigned[0] as { signed_url?: string } | undefined)?.signed_url ?? null,
    };

    const assignees = inspector
      ? [{
          id: inspector.id,
          task_id: job.id,
          user_id: inspector.id,
          role: "technician" as const,
          user_profile: inspector,
        }]
      : [];

    const { data: planRows, error: planError } = await admin
      .from("snagging_floor_plans")
      .select("id, job_id, label, storage_path, width, height, sort_order")
      .eq("job_id", id)
      .order("sort_order", { ascending: true });
    if (planError) throw new Error(planError.message);
    const floor_plans = await signMediaPaths(
      admin,
      (planRows ?? []).map((p) => ({ ...p, task_id: p.job_id })),
    );

    // Sign the signature image so the report can render the sign-off; the
    // stored path is private like every other object in the bucket.
    const signatureRow = job.signature_path
      ? (await signMediaPaths(admin, [{ id: job.id, storage_path: job.signature_path }]))[0]
      : null;
    const submissions = job.signed_at
      ? [{
          id: job.id,
          task_id: job.id,
          attempt: 1,
          signed_at: job.signed_at,
          signer_name: job.signer_name,
          signature_path: job.signature_path,
          signature_url: (signatureRow as { signed_url?: string } | null)?.signed_url ?? null,
        }]
      : [];

    return NextResponse.json({
      data: {
        ...job,
        task_type: "single_unit",
        parent_task_id: job.parent_job_id,
        property: propertyWithDocs,
        areas,
        assignees,
        approvals: [],
        floor_plans,
        submissions,
        snags,
        checklist: checklist ?? [],
      },
    });
  } catch (error) {
    console.error("Snagging task GET error:", error);
    return NextResponse.json({ error: "Failed to load inspection" }, { status: 500 });
  }
}

/** Schedule, assignment, and note edits. Status moves have their own routes. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = updateTaskSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();
    const { data: existing, error: loadError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, locked, inspector_id, approval_manager_id, scheduled_date, appointment_at, parent_job_id")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!existing) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    if (existing.locked) {
      return NextResponse.json(
        { error: "This inspection is locked. Reject it back to the inspector to make changes." },
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
        updates.scheduled_date = input.appointment_at ? input.appointment_at.slice(0, 10) : null;
      }
    }
    if (input.scheduled_date !== undefined) updates.scheduled_date = input.scheduled_date;
    if (input.approval_manager_id !== undefined) updates.approval_manager_id = input.approval_manager_id;
    // Site contacts (FR-3.03), editable after creation.
    if (input.developer_contact_name !== undefined) updates.developer_contact_name = input.developer_contact_name;
    if (input.developer_contact_phone !== undefined) updates.developer_contact_phone = input.developer_contact_phone;
    if (input.client_contact_name !== undefined) updates.client_contact_name = input.client_contact_name;
    if (input.client_contact_phone !== undefined) updates.client_contact_phone = input.client_contact_phone;
    if (input.notes !== undefined) updates.notes = input.notes;
    // Status moves normally go through the dedicated action routes (submit,
    // approve, reject, deliver). The only status change this generic edit
    // still serves is cancellation, so any status it is asked to write must
    // be a legal transition from the current one — a PATCH cannot skip or
    // reverse the state machine. (The schema already caps the field to
    // draft/assigned/cancelled, so the approval chain is unreachable here.)
    if (input.status !== undefined && input.status !== existing.status) {
      try {
        assertTransition(existing.status as SnaggingTaskStatus, input.status as SnaggingTaskStatus);
      } catch (transitionError) {
        return NextResponse.json({ error: (transitionError as Error).message }, { status: 409 });
      }
      updates.status = input.status;
    }

    // Inspector assignment (FR-3.08). Single inspector per job: first wins.
    let assignedInspectorId: string | null | undefined;
    if (input.technician_ids !== undefined) {
      assignedInspectorId = input.technician_ids[0] ?? null;
      updates.inspector_id = assignedInspectorId;
    }

    // Assigning (or changing to) a real inspector is gated server-side, so a
    // direct PATCH cannot bypass the quotation approval the UI enforces.
    const assigningInspector =
      assignedInspectorId != null && assignedInspectorId !== existing.inspector_id;
    if (assigningInspector) {
      // 1. The client must have approved the quotation — unless this is a child
      //    job (de-snag round / additional visit), whose parent already cleared
      //    the gate and which is created assigned by design.
      const isChild = existing.parent_job_id != null;
      if (!isChild) {
        const { data: quote } = await admin
          .from("snagging_quotations")
          .select("status")
          .eq("job_id", id)
          .maybeSingle();
        if (!quote || quote.status !== "approved") {
          return NextResponse.json(
            { error: "Assign an inspector only after the client approves the quotation." },
            { status: 409 },
          );
        }
      }
      // 2. An approval manager is mandatory (already on the job, or set now).
      const managerId =
        input.approval_manager_id !== undefined ? input.approval_manager_id : existing.approval_manager_id;
      if (!managerId) {
        return NextResponse.json(
          { error: "Select an approval manager before assigning an inspector." },
          { status: 400 },
        );
      }
      // 3. No double-booking: the inspector must be free on the appointment day.
      const day = (updates.scheduled_date as string | null | undefined) ?? existing.scheduled_date ?? null;
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
      const { error: updateError } = await admin.from("snagging_jobs").update(updates).eq("id", id);
      if (updateError) throw new Error(updateError.message);
    }

    if (assigningInspector) {
      await recordAudit(admin, {
        entityType: "task",
        entityId: id,
        taskId: id,
        eventType: "inspector_assigned",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: { inspector_id: assignedInspectorId, code: existing.code },
      });
    }

    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("Snagging task PATCH error:", error);
    return NextResponse.json({ error: "Failed to update inspection" }, { status: 500 });
  }
}

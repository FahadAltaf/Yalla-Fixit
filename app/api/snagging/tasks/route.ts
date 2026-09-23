import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { resolveClient } from "@/lib/server/snagging/client";
import { generateTaskCode } from "@/lib/server/snagging/workflow";
import { listJobs } from "@/lib/server/snagging/job-list";
import {
  propertySnapshot,
  resolveProperty,
} from "@/lib/server/snagging/property";
import { createTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

/**
 * Inspection jobs (FR-1.01 to FR-1.06).
 *
 * The lean schema merged property + floor plan + submission + the single
 * inspector into `snagging_jobs`, and clients into `snagging_clients`.
 * These handlers map that onto the same JSON shapes the dashboard and the
 * mobile app already read, so nothing downstream had to change.
 */
export async function GET(req: NextRequest) {
  try {
    // const { profile, accessUser } = await getRequestUserAccess(req);
    // if (!profile || !accessUser) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }
    // if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
    //   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // }

    const params = req.nextUrl.searchParams;
    const admin = await createAdminServerClient();
    return NextResponse.json(await listJobs(admin, params));
  } catch (error) {
    console.error("Snagging tasks GET error:", error);
    return NextResponse.json(
      { error: "Failed to load inspections" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = createTaskSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const p = input.property;
    if (!p) {
      return NextResponse.json(
        { error: "Provide client and unit details" },
        { status: 400 },
      );
    }

    const admin = await createAdminServerClient();

    // 1. Resolve the client. A client the picker already persisted arrives
    // by id; otherwise find-or-create one from the typed details.
    const clientId = await resolveClient(admin, {
      clientId: input.client_id ?? null,
      name: p.client_name,
      email: emptyToNull(p.client_email),
      phone: emptyToNull(p.client_phone),
      createdBy: profile.id,
    });

    // 1b. Resolve the property record (BR-1). Reuses the client's property
    // for this unit or creates one; the full attributes live there now. The
    // job keeps only a 5-field snapshot for the list search and mobile wire.
    const property = await resolveProperty(admin, {
      propertyId: input.property_id ?? null,
      clientId,
      fields: p,
      createdBy: profile.id,
    });
    const snapshot = propertySnapshot(property.columns);

    // 2. Create the job. The unique index on `code` is the arbiter.
    // An inspector is NOT assigned here (FR-3.08): assignment is gated on the
    // client approving the quotation, and happens from the job afterwards. A
    // brand-new job has no approved quotation, so it starts unassigned.
    const inspectorId = null;
    let job: { id: string; code: string } | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 5 && !job; attempt += 1) {
      const code = generateTaskCode(p.unit_label, p.building_name);
      // Appointment carries date + time; scheduled_date stays in step for the
      // mobile list, derived from the appointment when one is given.
      const appointmentAt = emptyToNull(input.appointment_at);
      const scheduledDate =
        emptyToNull(input.scheduled_date) ??
        (appointmentAt ? appointmentAt.slice(0, 10) : null);

      const { data, error } = await admin
        .from("snagging_jobs")
        .insert({
          // Jobs start as draft; approving the quotation unlocks assignment
          // and moves the job to `assigned` (BR-2, F6).
          code,
          status: "draft",
          client_id: clientId,
          property_id: property.id,
          // Denormalised snapshot for the list search + mobile wire; the full
          // property record lives in snagging_properties (BR-1).
          unit_label: snapshot.unit_label,
          building_name: snapshot.building_name,
          community: snapshot.community,
          property_type: snapshot.property_type,
          developer_name: snapshot.developer_name,
          // Assignment + schedule (I1-I4).
          inspector_id: inspectorId,
          approval_manager_id: input.approval_manager_id ?? null,
          appointment_at: appointmentAt,
          scheduled_date: scheduledDate,
          developer_contact_name: emptyToNull(input.developer_contact_name),
          developer_contact_phone: emptyToNull(input.developer_contact_phone),
          client_contact_name: emptyToNull(input.client_contact_name),
          client_contact_phone: emptyToNull(input.client_contact_phone),
          notes: emptyToNull(input.notes),
          created_by: profile.id,
        })
        .select("id, code")
        .single();
      if (!error) {
        job = data;
        break;
      }
      lastError = error.message;
      if (error.code !== "23505") throw new Error(error.message);
    }
    if (!job)
      throw new Error(lastError ?? "Could not allocate an inspection code");

    // 3. Areas from the explicit list the wizard sends.
    const areas = (input.areas ?? []).map((area, index) => ({
      job_id: job!.id,
      name: area.name,
      catalogue_area_code: area.catalogue_area_code ?? null,
      sort_order: (index + 1) * 10,
    }));
    if (areas.length > 0) {
      const { error: areaError } = await admin
        .from("snagging_areas")
        .insert(areas);
      if (areaError) throw new Error(areaError.message);
    }

    // 4. Build the job checklist from the property type (N2, FR-3.10).
    await generateChecklist(admin, job.id, p.property_type);

    /*
      5. Bind the approved quotation to the job it paid for (BA v2, change 3).

      The quotation came first and has been agreed, so two things follow:
      the two records point at each other from here on, and the job skips
      `draft`. Draft exists to mean "waiting on a price the client has not
      agreed yet" — which is exactly what is no longer true.

      Guarded on `approved` and on the quotation still being unattached, so
      this cannot silently move a second job onto one client's agreement.
    */
    if (input.quotation_id) {
      const { data: bound, error: bindError } = await admin
        .from("snagging_quotations")
        .update({ job_id: job.id, updated_at: new Date().toISOString() })
        .eq("id", input.quotation_id)
        .eq("status", "approved")
        .is("job_id", null)
        .select("id, quote_number")
        .maybeSingle();
      if (bindError) throw new Error(bindError.message);

      if (bound) {
        const { error: statusError } = await admin
          .from("snagging_jobs")
          .update({ status: "assigned" })
          .eq("id", job.id)
          .eq("status", "draft");
        if (statusError) throw new Error(statusError.message);

        await recordAudit(admin, {
          entityType: "task",
          entityId: job.id,
          taskId: job.id,
          eventType: "job_created_from_quotation",
          actorId: profile.id,
          payload: { quote_number: bound.quote_number, quotation_id: bound.id },
        });
      } else {
        /*
          Not fatal. The job is real and the coordinator is looking at it;
          refusing to return it because the link could not be made would
          lose the areas and contacts they just entered. Logged so the
          mismatch can be chased.
        */
        console.warn(
          `Job ${job.code} could not be bound to quotation ${input.quotation_id} — not approved, or already attached to another job.`,
        );
      }
    }

    return NextResponse.json(
      { data: { id: job.id, code: job.code } },
      { status: 201 },
    );
  } catch (error) {
    console.error("Snagging tasks POST error:", error);
    return NextResponse.json(
      { error: "Failed to create inspection" },
      { status: 500 },
    );
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Copies the applicable library checks onto a job as its checklist (N2). */
async function generateChecklist(
  admin: Admin,
  jobId: string,
  propertyType: string,
) {
  const appliesColumn =
    propertyType === "villa"
      ? "applies_villa"
      : propertyType === "townhouse"
        ? "applies_townhouse"
        : propertyType === "commercial"
          ? "applies_commercial"
          : "applies_apartment";

  const { data: items, error } = await admin
    .from("snagging_checklist_items")
    .select("id, code, group_name, label, mandatory, sort_order")
    .eq("active", true)
    // The technician list only (N1/N7). The client list is one stored
    // document shared on request, never copied onto a job — including it
    // here would put a client-facing question in front of an inspector
    // and block submission on an answer they cannot give (N5).
    .eq("audience", "technician")
    .eq(appliesColumn, true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  if (!items || items.length === 0) return;

  const rows = items.map((item) => ({
    job_id: jobId,
    checklist_item_id: item.id,
    code: item.code,
    group_name: item.group_name,
    label: item.label,
    mandatory: item.mandatory,
    status: "pending" as const,
    sort_order: item.sort_order,
  }));
  const { error: insertError } = await admin
    .from("snagging_job_checklist")
    .upsert(rows, { onConflict: "job_id,code", ignoreDuplicates: true });
  if (insertError) throw new Error(insertError.message);
}

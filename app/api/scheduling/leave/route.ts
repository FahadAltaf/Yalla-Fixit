import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const createLeaveSchema = z
  .object({
    technicianFsmId: z.string().trim().min(1),
    leaveType: z.string().trim().min(1),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    notes: z.string().trim().optional().nullable(),
  })
  .refine((data) => new Date(data.endAt) >= new Date(data.startAt), {
    // LEAVE-006: leave end must not be earlier than leave start.
    message: "Leave end must not be earlier than leave start",
    path: ["endAt"],
  });

const updateLeaveSchema = z
  .object({
    id: z.string().uuid(),
    leaveType: z.string().trim().min(1).optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    notes: z.string().trim().optional().nullable(),
    status: z.enum(["active", "cancelled"]).optional(),
  })
  .refine(
    (data) => !data.startAt || !data.endAt || new Date(data.endAt) >= new Date(data.startAt),
    { message: "Leave end must not be earlier than leave start", path: ["endAt"] },
  );

// LEAVE-011/BR-021: a new or changed leave period doesn't silently remove
// existing assignments -- it's saved, and any overlap is surfaced so the
// schedule can be corrected. Checked against the current schedule version
// only; historical/rejected versions are not live commitments.
async function findAssignmentConflicts(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  technicianFsmId: string,
  startAt: string,
  endAt: string,
) {
  const { data: assignments, error } = await admin
    .from("schedule_entry_assignments")
    .select(
      "schedule_entry_id, schedule_entries!inner(id, start_at, end_at, title, fsm_work_order_id, fsm_appointment_id, schedule_version_id, schedule_versions!inner(is_current, status))",
    )
    .eq("technician_fsm_id", technicianFsmId)
    .eq("schedule_entries.schedule_versions.is_current", true)
    .lt("schedule_entries.start_at", endAt)
    .gt("schedule_entries.end_at", startAt);

  if (error) throw new Error(error.message);
  return assignments ?? [];
}

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const technicianFsmId = params.get("technicianFsmId");
    const status = params.get("status");
    const search = params.get("search")?.trim().toLowerCase();

    const admin = await createAdminServerClient();
    let query = admin
      .from("leave_records")
      .select("*, technician:technician_reference(fsm_resource_id, display_name, is_active, last_synced_at)")
      .order("start_at", { ascending: false });

    if (technicianFsmId) query = query.eq("technician_fsm_id", technicianFsmId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    let records = data ?? [];
    if (search) {
      records = records.filter((record: any) =>
        [record.leave_type, record.technician?.display_name ?? ""].some((value: string) =>
          value.toLowerCase().includes(search),
        ),
      );
    }

    return NextResponse.json({ data: records });
  } catch (error) {
    console.error("Scheduling leave GET error:", error);
    return NextResponse.json({ error: "Failed to load leave records" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = createLeaveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const payload = parsed.data;

    const admin = await createAdminServerClient();
    const { data: created, error } = await admin
      .from("leave_records")
      .insert({
        technician_fsm_id: payload.technicianFsmId,
        leave_type: payload.leaveType,
        start_at: payload.startAt,
        end_at: payload.endAt,
        notes: payload.notes || null,
        created_by: profile.id,
        updated_by: profile.id,
      })
      .select("*, technician:technician_reference(fsm_resource_id, display_name, is_active, last_synced_at)")
      .single();

    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "leave_created",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "leave_record",
      affected_entity_id: created.id,
      after_value: payload,
    });

    const conflicts = await findAssignmentConflicts(
      admin,
      payload.technicianFsmId,
      payload.startAt,
      payload.endAt,
    );

    return NextResponse.json({ data: { record: created, conflicts } });
  } catch (error) {
    console.error("Scheduling leave POST error:", error);
    return NextResponse.json({ error: "Failed to create leave record" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = updateLeaveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const payload = parsed.data;

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("leave_records")
      .select("*")
      .eq("id", payload.id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Leave record not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };
    if (payload.leaveType !== undefined) updateData.leave_type = payload.leaveType;
    if (payload.startAt !== undefined) updateData.start_at = payload.startAt;
    if (payload.endAt !== undefined) updateData.end_at = payload.endAt;
    if (payload.notes !== undefined) updateData.notes = payload.notes || null;
    if (payload.status !== undefined) {
      updateData.status = payload.status;
      if (payload.status === "cancelled") {
        // LEAVE-005: cancelled records remain in audit history, not deleted.
        updateData.cancelled_by = profile.id;
        updateData.cancelled_at = new Date().toISOString();
      }
    }

    const { data: updated, error } = await admin
      .from("leave_records")
      .update(updateData)
      .eq("id", payload.id)
      .select("*, technician:technician_reference(fsm_resource_id, display_name, is_active, last_synced_at)")
      .single();
    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: payload.status === "cancelled" ? "leave_cancelled" : "leave_updated",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "leave_record",
      affected_entity_id: payload.id,
      before_value: existing,
      after_value: updated,
    });

    const conflicts =
      updated.status === "active"
        ? await findAssignmentConflicts(admin, updated.technician_fsm_id, updated.start_at, updated.end_at)
        : [];

    return NextResponse.json({ data: { record: updated, conflicts } });
  } catch (error) {
    console.error("Scheduling leave PUT error:", error);
    return NextResponse.json({ error: "Failed to update leave record" }, { status: 500 });
  }
}

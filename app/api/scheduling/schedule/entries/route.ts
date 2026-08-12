import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const baseEntrySchema = {
  scheduleVersionId: z.string().uuid(),
  shift: z.enum(["day", "night"]),
  operatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  technicianFsmIds: z.array(z.string().trim().min(1)),
  notes: z.string().trim().optional().nullable(),
};

const createEntrySchema = z
  .discriminatedUnion("entryType", [
    z.object({
      entryType: z.literal("free_text"),
      title: z.string().trim().min(1),
      ...baseEntrySchema,
    }),
    z.object({
      entryType: z.literal("existing_appointment"),
      fsmWorkOrderId: z.string().trim().min(1),
      fsmAppointmentId: z.string().trim().min(1),
      // Display names (WO2361 / AP1043) -- what the grid actually shows.
      fsmWorkOrderName: z.string().trim().optional().nullable(),
      fsmAppointmentName: z.string().trim().optional().nullable(),
      title: z.string().trim().optional().nullable(),
      clientName: z.string().trim().optional().nullable(),
      contactName: z.string().trim().optional().nullable(),
      address: z.string().trim().optional().nullable(),
      ...baseEntrySchema,
    }),
    z.object({
      entryType: z.literal("new_appointment"),
      fsmWorkOrderId: z.string().trim().min(1),
      fsmWorkOrderName: z.string().trim().optional().nullable(),
      title: z.string().trim().optional().nullable(),
      clientName: z.string().trim().optional().nullable(),
      contactName: z.string().trim().optional().nullable(),
      address: z.string().trim().optional().nullable(),
      // The team chooses which service line(s) the new appointment covers,
      // its Type, and Time-bound vs All Day (Zoho FSM create requirements).
      serviceLineItemIds: z.array(z.string().trim().min(1)).min(1, "Select at least one service line"),
      serviceTaskLineItemIds: z.array(z.string().trim().min(1)).optional(),
      appointmentType: z.string().trim().min(1).refine((v) => v !== "-None-", "Choose an appointment type"),
      scheduleType: z.enum(["Time-bound", "All Day"]),
      ...baseEntrySchema,
    }),
  ])
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: "End time must be after start time",
    path: ["endAt"],
  })
  .refine((data) => data.entryType === "free_text" || data.technicianFsmIds.length > 0, {
    // PLAN-011/13.1: at least one technician for a placed FSM-backed entry.
    message: "At least one technician is required",
    path: ["technicianFsmIds"],
  });

async function assertDraftEditable(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  scheduleVersionId: string,
) {
  const { data: version, error } = await admin
    .from("schedule_versions")
    .select("id, status")
    .eq("id", scheduleVersionId)
    .single();
  if (error || !version) throw new Error("Schedule version not found");
  if (version.status !== "draft" && version.status !== "draft_revision") {
    throw new Error(`Cannot modify entries while the version is ${version.status}`);
  }
  return version;
}

// LEAVE-010/PLAN-021: block a new assignment that overlaps active leave.
async function findLeaveConflicts(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  technicianFsmIds: string[],
  startAt: string,
  endAt: string,
) {
  if (technicianFsmIds.length === 0) return [];
  const { data, error } = await admin
    .from("leave_records")
    .select("id, technician_fsm_id, leave_type, start_at, end_at, technician_reference(display_name)")
    .in("technician_fsm_id", technicianFsmIds)
    .eq("status", "active")
    .lt("start_at", endAt)
    .gt("end_at", startAt);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Build a message that names who is on leave (per YFI feedback on AC-025).
// Supabase types the embedded relation as an array, so normalise it.
function leaveConflictMessage(
  conflicts: Array<{
    leave_type: string;
    technician_reference?: { display_name?: string } | { display_name?: string }[] | null;
  }>,
) {
  const names = conflicts.map((c) => {
    const ref = Array.isArray(c.technician_reference) ? c.technician_reference[0] : c.technician_reference;
    return `${ref?.display_name ?? "A technician"} (${c.leave_type})`;
  });
  return `Cannot assign — on leave during this time: ${names.join(", ")}`;
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

    const parsed = createEntrySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const payload = parsed.data;

    const admin = await createAdminServerClient();
    await assertDraftEditable(admin, payload.scheduleVersionId);

    // A work order can carry several appointments (one per service line), but
    // the SAME service line must not be scheduled twice in one version. This
    // replaces the old work-order-level uniqueness that wrongly blocked a
    // second appointment for the same work order (YFI note on WO2361).
    if (payload.entryType === "new_appointment") {
      const { data: siblings } = await admin
        .from("schedule_entries")
        .select("fsm_service_line_item_ids, fsm_work_order_name, fsm_appointment_name, title")
        .eq("schedule_version_id", payload.scheduleVersionId)
        .eq("entry_type", "new_appointment");
      const clash = payload.serviceLineItemIds.filter((id) =>
        (siblings ?? []).some((s) => ((s.fsm_service_line_item_ids as string[] | null) ?? []).includes(id)),
      );
      if (clash.length > 0) {
        // Name the appointment that already holds the clashing line, so the
        // scheduler knows exactly where the conflict is.
        const owner = (siblings ?? []).find((s) =>
          ((s.fsm_service_line_item_ids as string[] | null) ?? []).some((id) => clash.includes(id)),
        );
        const ownerLabel = owner
          ? `${owner.fsm_work_order_name || "a work order"} · ${owner.fsm_appointment_name || owner.title || "another new appointment"}`
          : "another appointment for this day";
        return NextResponse.json(
          {
            error: `Service line already scheduled on ${ownerLabel} for this day. A service line can only be on one appointment per day.`,
          },
          { status: 409 },
        );
      }
    }

    const leaveConflicts = await findLeaveConflicts(
      admin,
      payload.technicianFsmIds,
      payload.startAt,
      payload.endAt,
    );
    if (leaveConflicts.length > 0) {
      return NextResponse.json(
        { error: leaveConflictMessage(leaveConflicts), conflicts: leaveConflicts },
        { status: 409 },
      );
    }

    const insertRow: Record<string, unknown> = {
      schedule_version_id: payload.scheduleVersionId,
      entry_type: payload.entryType,
      shift: payload.shift,
      operating_date: payload.operatingDate,
      start_at: payload.startAt,
      end_at: payload.endAt,
      notes: payload.notes || null,
      origin: "portal",
      needs_sync: true, // a newly-added entry must be written to FSM on approval
      created_by: profile.id,
      updated_by: profile.id,
    };

    if (payload.entryType === "free_text") {
      insertRow.title = payload.title;
      insertRow.sync_status = "not_ready";
    } else {
      insertRow.fsm_work_order_id = payload.fsmWorkOrderId;
      insertRow.fsm_work_order_name = payload.fsmWorkOrderName || null;
      insertRow.title = payload.title || null;
      insertRow.client_name = payload.clientName || null;
      insertRow.contact_name = payload.contactName || null;
      insertRow.address = payload.address || null;
      insertRow.sync_status = "ready";
      if (payload.entryType === "existing_appointment") {
        insertRow.fsm_appointment_id = payload.fsmAppointmentId;
        insertRow.fsm_appointment_name = payload.fsmAppointmentName || null;
      }
      // PLAN-007/BR-009: "new_appointment" entries intentionally have no
      // fsm_appointment_id until approval creates it (Pending Appointment
      // Creation). They DO carry the create parameters chosen now.
      if (payload.entryType === "new_appointment") {
        insertRow.fsm_service_line_item_ids = payload.serviceLineItemIds;
        insertRow.fsm_service_task_line_item_ids = payload.serviceTaskLineItemIds ?? null;
        insertRow.fsm_appointment_type = payload.appointmentType;
        insertRow.fsm_schedule_type = payload.scheduleType;
      }
    }

    const { data: entry, error: entryError } = await admin
      .from("schedule_entries")
      .insert(insertRow)
      .select("*")
      .single();

    if (entryError) {
      if (entryError.code === "23505") {
        // PLAN-006/PLAN-018: duplicate appointment or pending work order.
        return NextResponse.json(
          { error: "This appointment or work order is already on the schedule for this day" },
          { status: 409 },
        );
      }
      throw new Error(entryError.message);
    }

    if (payload.technicianFsmIds.length > 0) {
      const { error: assignError } = await admin.from("schedule_entry_assignments").insert(
        payload.technicianFsmIds.map((id) => ({
          schedule_entry_id: entry.id,
          technician_fsm_id: id,
        })),
      );
      if (assignError) throw new Error(assignError.message);
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "entry_added",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: payload.scheduleVersionId,
      affected_entity_type: "schedule_entry",
      affected_entity_id: entry.id,
      after_value: insertRow,
    });

    return NextResponse.json({ data: entry });
  } catch (error) {
    console.error("Schedule entry POST error:", error);
    const message = error instanceof Error ? error.message : "Failed to add schedule entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const updateEntrySchema = z.object({
  id: z.string().uuid(),
  shift: z.enum(["day", "night"]).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  technicianFsmIds: z.array(z.string().trim().min(1)).optional(),
  title: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = updateEntrySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const payload = parsed.data;

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("schedule_entries")
      .select("*")
      .eq("id", payload.id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    await assertDraftEditable(admin, existing.schedule_version_id);

    const newStart = payload.startAt ?? existing.start_at;
    const newEnd = payload.endAt ?? existing.end_at;
    if (new Date(newEnd) <= new Date(newStart)) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
    }

    if (payload.technicianFsmIds) {
      const leaveConflicts = await findLeaveConflicts(admin, payload.technicianFsmIds, newStart, newEnd);
      if (leaveConflicts.length > 0) {
        return NextResponse.json(
          { error: leaveConflictMessage(leaveConflicts), conflicts: leaveConflicts },
          { status: 409 },
        );
      }
    }

    const updateData: Record<string, unknown> = {
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };
    if (payload.shift !== undefined) updateData.shift = payload.shift;
    if (payload.startAt !== undefined) updateData.start_at = payload.startAt;
    if (payload.endAt !== undefined) updateData.end_at = payload.endAt;
    if (payload.title !== undefined) updateData.title = payload.title || null;
    if (payload.notes !== undefined) updateData.notes = payload.notes || null;

    // A change to time, shift or technicians means FSM must be updated on the
    // next approval. (Time/shift below; technicians further down.)
    const editsSchedule =
      payload.startAt !== undefined ||
      payload.endAt !== undefined ||
      payload.shift !== undefined ||
      payload.technicianFsmIds !== undefined;
    if (editsSchedule) updateData.needs_sync = true;

    const { data: updated, error: updateError } = await admin
      .from("schedule_entries")
      .update(updateData)
      .eq("id", payload.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    if (payload.technicianFsmIds) {
      const { error: deleteError } = await admin
        .from("schedule_entry_assignments")
        .delete()
        .eq("schedule_entry_id", payload.id);
      if (deleteError) throw new Error(deleteError.message);

      if (payload.technicianFsmIds.length > 0) {
        const { error: insertError } = await admin.from("schedule_entry_assignments").insert(
          payload.technicianFsmIds.map((id) => ({
            schedule_entry_id: payload.id,
            technician_fsm_id: id,
          })),
        );
        if (insertError) throw new Error(insertError.message);
      }
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "entry_updated",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: existing.schedule_version_id,
      affected_entity_type: "schedule_entry",
      affected_entity_id: payload.id,
      before_value: existing,
      after_value: updateData,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Schedule entry PUT error:", error);
    const message = error instanceof Error ? error.message : "Failed to update schedule entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.DELETE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("schedule_entries")
      .select("*")
      .eq("id", id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    // PLAN-017: removing a Pending Appointment Creation entry leaves FSM
    // unchanged because no appointment has been created yet -- true here
    // since draft entries never touch FSM regardless of entry_type.
    await assertDraftEditable(admin, existing.schedule_version_id);

    const { error } = await admin.from("schedule_entries").delete().eq("id", id);
    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "entry_removed",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: existing.schedule_version_id,
      affected_entity_type: "schedule_entry",
      affected_entity_id: id,
      before_value: existing,
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Schedule entry DELETE error:", error);
    const message = error instanceof Error ? error.message : "Failed to remove schedule entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { LOOKUP_KEYS } from "@/lib/server/attribute-list-route";
import { ActionType, ResourceType } from "@/types/types";

const MAX_TECHNICIANS_PER_LEAVE = 200;

const createLeaveSchema = z
  .object({
    // One technician, or several for the same period (FR-21: a Public
    // Holiday entered for a whole team in one go). One of the two is required.
    technicianFsmId: z.string().trim().min(1).optional(),
    technicianFsmIds: z.array(z.string().trim().min(1)).min(1).max(MAX_TECHNICIANS_PER_LEAVE).optional(),
    leaveType: z.string().trim().min(1),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    notes: z.string().trim().optional().nullable(),
  })
  .refine((data) => new Date(data.endAt) >= new Date(data.startAt), {
    // LEAVE-006: leave end must not be earlier than leave start.
    message: "Leave end must not be earlier than leave start",
    path: ["endAt"],
  })
  .refine((data) => Boolean(data.technicianFsmId) || (data.technicianFsmIds?.length ?? 0) > 0, {
    message: "At least one technician is required",
    path: ["technicianFsmIds"],
  });

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

const normalise = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/*
  FR-21: a new leave takes its type from the managed list (lookup_options,
  list_key 'leave_type'), matched case-insensitively. Returns the list's own
  spelling, or null when the name is not on the list. Older free-text
  records are never re-checked: PUT only validates a type that changes.

  The list is small, so it is read whole and matched in code rather than
  with ilike: PostgREST rewrites `*` in a like pattern to `%`, which a
  caller could use to match any type at all.
*/
async function resolveLeaveType(admin: Admin, name: string): Promise<string | null> {
  const { data, error } = await admin
    .from("lookup_options")
    .select("name")
    .eq("list_key", LOOKUP_KEYS.leaveType);
  if (error) throw new Error(error.message);
  const wanted = normalise(name);
  return (data ?? []).find((row: { name: string }) => normalise(row.name) === wanted)?.name ?? null;
}

const unknownLeaveType = (name: string) =>
  NextResponse.json(
    { error: `"${name}" is not on the leave types list. Pick a type from the list, or add it under Manage lists.` },
    { status: 400 },
  );

const updateLeaveSchema = z
  .object({
    id: z.string().uuid(),
    leaveType: z.string().trim().min(1).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
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
  technicianFsmIds: string[],
  startAt: string,
  endAt: string,
) {
  // One query for every technician (a Public Holiday can cover the whole
  // team), each row tagged with its technician.
  const { data: assignments, error } = await admin
    .from("schedule_entry_assignments")
    .select(
      "schedule_entry_id, technician_fsm_id, schedule_entries!inner(id, start_at, end_at, title, fsm_work_order_id, fsm_appointment_id, schedule_version_id, schedule_versions!inner(is_current, status))",
    )
    .in("technician_fsm_id", technicianFsmIds)
    .eq("schedule_entries.schedule_versions.is_current", true)
    .lt("schedule_entries.start_at", endAt)
    .gt("schedule_entries.end_at", startAt);

  if (error) throw new Error(error.message);
  return assignments ?? [];
}

/*
  The conflict lookup runs AFTER the leave rows are written. A failure in it
  must not turn into a 500, because the screen would offer a retry and the
  retry would write the same leave again: the rows are returned with an
  empty conflict list and a flag instead.
*/
async function conflictsAfterSave(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  technicianFsmIds: string[],
  startAt: string,
  endAt: string,
) {
  try {
    return { conflicts: await findAssignmentConflicts(admin, technicianFsmIds, startAt, endAt), conflictsError: false };
  } catch (error) {
    console.error("Scheduling leave: conflict lookup failed after save:", error);
    return { conflicts: [], conflictsError: true };
  }
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
    const leaveType = params.get("leaveType")?.trim();

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
    // FR-21: exact type name, case-insensitive, so old free-text spellings
    // ("annual leave") and listed ones ("Annual Leave") filter together.
    if (leaveType) {
      const wanted = normalise(leaveType);
      records = records.filter((record: any) => normalise(record.leave_type) === wanted);
    }
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
    const technicianIds = Array.from(
      new Set(payload.technicianFsmIds ?? (payload.technicianFsmId ? [payload.technicianFsmId] : [])),
    );

    const admin = await createAdminServerClient();

    const leaveType = await resolveLeaveType(admin, payload.leaveType);
    if (!leaveType) return unknownLeaveType(payload.leaveType);

    // FR-23: leave is for people who still work here. An unknown id, or a
    // technician FSM has deactivated, is refused by name so the screen can
    // say who was left out.
    const { data: technicianRows, error: technicianError } = await admin
      .from("technician_reference")
      .select("fsm_resource_id, display_name, is_active")
      .in("fsm_resource_id", technicianIds);
    if (technicianError) throw new Error(technicianError.message);
    const technicianById = new Map(
      (technicianRows ?? []).map((row: { fsm_resource_id: string; display_name: string; is_active: boolean }) => [
        row.fsm_resource_id,
        row,
      ]),
    );
    const unknown = technicianIds.filter((id) => !technicianById.has(id));
    const inactive = technicianIds.filter((id) => technicianById.get(id)?.is_active === false);
    if (unknown.length > 0 || inactive.length > 0) {
      const names = inactive.map((id) => technicianById.get(id)?.display_name ?? id);
      const parts = [
        inactive.length > 0 ? `inactive: ${names.join(", ")}` : null,
        unknown.length > 0 ? `unknown: ${unknown.join(", ")}` : null,
      ].filter(Boolean);
      return NextResponse.json(
        { error: `Leave can only be added for active technicians (${parts.join("; ")})` },
        { status: 400 },
      );
    }

    const { data: created, error } = await admin
      .from("leave_records")
      .insert(
        technicianIds.map((technicianFsmId) => ({
          technician_fsm_id: technicianFsmId,
          leave_type: leaveType,
          start_at: payload.startAt,
          end_at: payload.endAt,
          notes: payload.notes || null,
          created_by: profile.id,
          updated_by: profile.id,
        })),
      )
      .select("*, technician:technician_reference(fsm_resource_id, display_name, is_active, last_synced_at)");

    if (error) throw new Error(error.message);
    const records = created ?? [];

    await admin.from("schedule_audit_events").insert(
      records.map((record: { id: string; technician_fsm_id: string }) => ({
        event_type: "leave_created",
        actor_id: profile.id,
        origin: "portal",
        affected_entity_type: "leave_record",
        affected_entity_id: record.id,
        after_value: { ...payload, technicianFsmIds: undefined, technicianFsmId: record.technician_fsm_id, leaveType },
      })),
    );

    const { conflicts, conflictsError } = await conflictsAfterSave(admin, technicianIds, payload.startAt, payload.endAt);

    return NextResponse.json({ data: { record: records[0], records, conflicts, conflictsError } });
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
    if (
      payload.leaveType !== undefined &&
      payload.leaveType.trim().toLowerCase() !== String(existing.leave_type ?? "").trim().toLowerCase()
    ) {
      // Only a CHANGED type is checked against the list, so a record made
      // before the list existed can still be edited or cancelled as it is.
      const leaveType = await resolveLeaveType(admin, payload.leaveType);
      if (!leaveType) return unknownLeaveType(payload.leaveType);
      updateData.leave_type = leaveType;
    }
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

    const { conflicts, conflictsError } =
      updated.status === "active"
        ? await conflictsAfterSave(admin, [updated.technician_fsm_id], updated.start_at, updated.end_at)
        : { conflicts: [], conflictsError: false };

    return NextResponse.json({ data: { record: updated, conflicts, conflictsError } });
  } catch (error) {
    console.error("Scheduling leave PUT error:", error);
    return NextResponse.json({ error: "Failed to update leave record" }, { status: 500 });
  }
}

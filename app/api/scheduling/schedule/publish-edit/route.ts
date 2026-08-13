import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";
import { syncEntryToFsm, type SyncEntryRow } from "@/lib/server/schedule-sync";

const publishEditSchema = z
  .object({
    entryId: z.string().uuid(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    shift: z.enum(["day", "night"]).optional(),
    technicianFsmIds: z.array(z.string().trim().min(1)).min(1),
  })
  .refine((d) => new Date(d.endAt) > new Date(d.startAt), {
    message: "End time must be after start time",
    path: ["endAt"],
  });

// AC-016 / SYNC-019 / BR-010: change the time or technicians on an appointment
// that is ALREADY published to FSM, and push the change immediately — no
// whole-day revision and re-approval. Only the approver may do this, because
// it writes to FSM directly.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = await createAdminServerClient();
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.APPROVE)) {
      return NextResponse.json(
        { error: "You don't have permission to edit a published appointment" },
        { status: 403 },
      );
    }

    const parsed = publishEditSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { entryId, startAt, endAt, shift, technicianFsmIds } = parsed.data;

    const { data: entry, error: entryError } = await admin
      .from("schedule_entries")
      .select("*, schedule_versions!inner(id, status, is_current, daily_schedule_id)")
      .eq("id", entryId)
      .single();
    if (entryError || !entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const version = (entry as any).schedule_versions;
    const publishedLike = ["published", "published_fsm_changed", "partially_synced"].includes(version.status);
    if (!version.is_current || !publishedLike) {
      return NextResponse.json(
        { error: "This entry is not on a published day. Edit it in the draft instead." },
        { status: 409 },
      );
    }
    if (entry.entry_type === "free_text" || !entry.fsm_appointment_id) {
      return NextResponse.json(
        { error: "Only an appointment that already exists in FSM can be edited this way." },
        { status: 409 },
      );
    }

    // LEAVE-010: don't push an assignment that overlaps active leave.
    const { data: leaveConflicts } = await admin
      .from("leave_records")
      .select("technician_fsm_id, leave_type, technician_reference(display_name)")
      .in("technician_fsm_id", technicianFsmIds)
      .eq("status", "active")
      .lt("start_at", endAt)
      .gt("end_at", startAt);
    if (leaveConflicts && leaveConflicts.length > 0) {
      const names = leaveConflicts.map((c) => {
        const ref = Array.isArray(c.technician_reference) ? c.technician_reference[0] : c.technician_reference;
        return `${ref?.display_name ?? "A technician"} (${c.leave_type})`;
      });
      return NextResponse.json(
        { error: `Cannot assign — on leave during this time: ${names.join(", ")}` },
        { status: 409 },
      );
    }

    // Apply the local change first so the sync helper reads the new values.
    const before = { start_at: entry.start_at, end_at: entry.end_at, shift: entry.shift };
    const localUpdate: Record<string, unknown> = {
      start_at: startAt,
      end_at: endAt,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };
    if (shift) localUpdate.shift = shift;
    await admin.from("schedule_entries").update(localUpdate).eq("id", entryId);

    await admin.from("schedule_entry_assignments").delete().eq("schedule_entry_id", entryId);
    await admin.from("schedule_entry_assignments").insert(
      technicianFsmIds.map((id) => ({ schedule_entry_id: entryId, technician_fsm_id: id })),
    );

    const syncRow: SyncEntryRow = {
      id: entry.id,
      entry_type: entry.entry_type,
      fsm_work_order_id: entry.fsm_work_order_id,
      fsm_appointment_id: entry.fsm_appointment_id,
      fsm_last_modified_marker: entry.fsm_last_modified_marker,
      start_at: startAt,
      end_at: endAt,
      title: entry.title,
    };
    const result = await syncEntryToFsm(admin, syncRow, version.id, "publish_edit");

    await admin.from("schedule_audit_events").insert({
      event_type: "published_appointment_edited",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: version.id,
      affected_entity_type: "schedule_entry",
      affected_entity_id: entryId,
      before_value: before,
      after_value: { start_at: startAt, end_at: endAt, technicianFsmIds, syncStatus: result.status },
    });

    if (result.status === "failed") {
      return NextResponse.json(
        { error: result.error ?? "Zoho FSM rejected the change", data: { synced: false } },
        { status: 502 },
      );
    }

    // A day that had drifted (published_fsm_changed) is realigned once its
    // appointment is re-pushed; clear the day-level flag if nothing else drifts.
    const { data: stillChanged } = await admin
      .from("schedule_entries")
      .select("id")
      .eq("schedule_version_id", version.id)
      .not("changed_in_fsm_at", "is", null)
      .limit(1);
    if (!stillChanged || stillChanged.length === 0) {
      await admin.from("daily_schedules").update({ has_fsm_changes: false }).eq("id", version.daily_schedule_id);
    }

    return NextResponse.json({ data: { synced: true } });
  } catch (error) {
    console.error("Publish-edit error:", error);
    const message = error instanceof Error ? error.message : "Failed to edit the appointment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

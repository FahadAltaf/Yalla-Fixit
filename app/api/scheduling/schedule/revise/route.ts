import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// The day is identified by its operating date now that daily_schedules is
// gone; the current version for that date is resolved server-side.
const reviseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Section 7.3/APR-011: adding work to a Published day requires a Draft
// Revision that copies the published plan, then whole-day reapproval.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = reviseSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { date } = parsed.data;

    const admin = await createAdminServerClient();
    const { data: currentVersion, error: cvError } = await admin
      .from("schedule_versions")
      .select("*")
      .eq("schedule_date", date)
      .eq("is_current", true)
      .maybeSingle();
    if (cvError) throw new Error(cvError.message);
    if (!currentVersion) {
      return NextResponse.json({ error: "No schedule exists for this date" }, { status: 404 });
    }
    if (!["published", "partially_synced"].includes(currentVersion.status)) {
      return NextResponse.json(
        { error: `Cannot create a revision from status ${currentVersion.status}` },
        { status: 409 },
      );
    }

    const { data: sourceEntries, error: entriesError } = await admin
      .from("schedule_entries")
      .select("*, schedule_entry_assignments(technician_fsm_id)")
      .eq("schedule_version_id", currentVersion.id);
    if (entriesError) throw new Error(entriesError.message);

    // BR-017: exactly one current version per date -- flip the pointer
    // atomically-ish (best effort in absence of a DB transaction helper).
    const { error: unsetError } = await admin
      .from("schedule_versions")
      .update({ is_current: false })
      .eq("id", currentVersion.id);
    if (unsetError) throw new Error(unsetError.message);

    const { data: revision, error: revisionError } = await admin
      .from("schedule_versions")
      .insert({
        schedule_date: date,
        version_number: currentVersion.version_number + 1,
        status: "draft_revision",
        parent_version_id: currentVersion.id,
        created_by: profile.id,
      })
      .select("*")
      .single();
    if (revisionError) {
      // Roll back the is_current flip if the insert failed.
      await admin.from("schedule_versions").update({ is_current: true }).eq("id", currentVersion.id);
      throw new Error(revisionError.message);
    }

    for (const entry of sourceEntries ?? []) {
      const { schedule_entry_assignments, id: _id, created_at: _createdAt, updated_at: _updatedAt, ...entryFields } = entry as any;
      const { data: newEntry, error: newEntryError } = await admin
        .from("schedule_entries")
        .insert({
          ...entryFields,
          schedule_version_id: revision.id,
          // Carried-over appointments are already live in FSM; they only need
          // re-syncing if the scheduler edits them in this revision.
          needs_sync: false,
        })
        .select("id")
        .single();
      if (newEntryError) throw new Error(newEntryError.message);

      const assignmentIds = (schedule_entry_assignments ?? []).map((a: { technician_fsm_id: string }) => a.technician_fsm_id);
      if (assignmentIds.length > 0) {
        const { error: assignError } = await admin.from("schedule_entry_assignments").insert(
          assignmentIds.map((technicianFsmId: string) => ({
            schedule_entry_id: newEntry.id,
            technician_fsm_id: technicianFsmId,
          })),
        );
        if (assignError) throw new Error(assignError.message);
      }
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "revision_created",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: revision.id,
      before_value: { parentVersionId: currentVersion.id },
    });

    return NextResponse.json({ data: revision });
  } catch (error) {
    console.error("Schedule revise error:", error);
    const message = error instanceof Error ? error.message : "Failed to create revision";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const clearSchema = z.object({
  scheduleVersionId: z.string().uuid(),
});

// Clears every entry from a draft day in one action (YFI request: "add a
// Clear schedule button"). Deliberately scoped to the *draft* — the same
// rule that guards single-entry deletion (PLAN-017): published work is
// already in FSM and must be revised, not wiped. Assignments cascade.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.DELETE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = clearSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { scheduleVersionId } = parsed.data;

    const admin = await createAdminServerClient();

    const { data: version, error: versionError } = await admin
      .from("schedule_versions")
      .select("id, status")
      .eq("id", scheduleVersionId)
      .single();
    if (versionError || !version) {
      return NextResponse.json({ error: "Schedule version not found" }, { status: 404 });
    }
    if (version.status !== "draft" && version.status !== "draft_revision") {
      return NextResponse.json(
        { error: `Cannot clear a schedule while the version is ${version.status}` },
        { status: 409 },
      );
    }

    const { data: existing, error: existingError } = await admin
      .from("schedule_entries")
      .select("*")
      .eq("schedule_version_id", scheduleVersionId);
    if (existingError) throw new Error(existingError.message);

    if ((existing ?? []).length === 0) {
      return NextResponse.json({ data: { removed: 0 } });
    }

    const { error: deleteError } = await admin
      .from("schedule_entries")
      .delete()
      .eq("schedule_version_id", scheduleVersionId);
    if (deleteError) throw new Error(deleteError.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "schedule_cleared",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: scheduleVersionId,
      affected_entity_type: "schedule_version",
      affected_entity_id: scheduleVersionId,
      before_value: { entries: existing },
    });

    return NextResponse.json({ data: { removed: (existing ?? []).length } });
  } catch (error) {
    console.error("Schedule clear error:", error);
    const message = error instanceof Error ? error.message : "Failed to clear the schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

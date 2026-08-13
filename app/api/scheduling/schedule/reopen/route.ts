import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const schema = z.object({ scheduleVersionId: z.string().uuid() });

// #4: a rejected day couldn't be edited. Reopening flips it back to an
// editable draft (keeping its entries and rejection history) so the scheduler
// can fix it and resubmit — no need to start the day over.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: version, error } = await admin
      .from("schedule_versions")
      .select("id, status, parent_version_id")
      .eq("id", parsed.data.scheduleVersionId)
      .single();
    if (error || !version) {
      return NextResponse.json({ error: "Schedule version not found" }, { status: 404 });
    }
    if (version.status !== "rejected") {
      return NextResponse.json(
        { error: `Only a rejected schedule can be reopened (this one is ${version.status})` },
        { status: 409 },
      );
    }

    // A revision reopens as draft_revision; a first version as a plain draft.
    const newStatus = version.parent_version_id ? "draft_revision" : "draft";
    const { data: updated, error: updateError } = await admin
      .from("schedule_versions")
      .update({ status: newStatus, submitted_at: null, submitted_by: null })
      .eq("id", version.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "version_reopened",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: version.id,
      before_value: { status: "rejected" },
      after_value: { status: newStatus },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Schedule reopen error:", error);
    const message = error instanceof Error ? error.message : "Failed to reopen the schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

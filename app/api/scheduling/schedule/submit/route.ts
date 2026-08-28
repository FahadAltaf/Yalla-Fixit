import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";
import { notifyApproversOfSubmission } from "@/lib/server/schedule-approvers";
import { publishVersionToFsm, PublishBlockedError } from "@/lib/server/publish-schedule";

// E1: the submitter either routes the day to a chosen approver, or selects
// "no approval needed" (skipApproval) to publish straight to FSM.
const submitSchema = z.object({
  scheduleVersionId: z.string().uuid(),
  approverId: z.string().uuid().nullable().optional(),
  skipApproval: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const admin = await createAdminServerClient();
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = submitSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { scheduleVersionId, approverId, skipApproval } = parsed.data;

    const { data: version, error: versionError } = await admin
      .from("schedule_versions")
      .select("*")
      .eq("id", scheduleVersionId)
      .single();
    if (versionError || !version) {
      return NextResponse.json({ error: "Schedule version not found" }, { status: 404 });
    }
    if (version.status !== "draft" && version.status !== "draft_revision") {
      return NextResponse.json({ error: `Cannot submit a version with status ${version.status}` }, { status: 409 });
    }

    const { data: entries, error: entriesError } = await admin
      .from("schedule_entries")
      .select("id")
      .eq("schedule_version_id", scheduleVersionId);
    if (entriesError) throw new Error(entriesError.message);
    if (!entries || entries.length === 0) {
      return NextResponse.json({ error: "Cannot submit an empty schedule" }, { status: 400 });
    }

    // ----- Path A: no approval needed -> publish straight to FSM (E1). -----
    if (skipApproval) {
      await admin.from("schedule_audit_events").insert({
        event_type: "version_submitted",
        actor_id: profile.id,
        origin: "portal",
        schedule_version_id: scheduleVersionId,
        after_value: { comment: "Submitted without approval", skipApproval: true },
      });
      const { version: published, results } = await publishVersionToFsm(admin, scheduleVersionId, profile.id, {
        comment: "No approval required",
      });
      return NextResponse.json({ data: { version: published, results, published: true } });
    }

    // ----- Path B: route to a chosen approver. -----
    const { data: updated, error: updateError } = await admin
      .from("schedule_versions")
      .update({
        status: "pending_approval",
        submitted_by: profile.id,
        submitted_at: new Date().toISOString(),
        requested_approver_id: approverId ?? null,
      })
      .eq("id", scheduleVersionId)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "version_submitted",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: scheduleVersionId,
      after_value: { requested_approver_id: approverId ?? null },
    });

    await notifyApproversOfSubmission(admin, {
      // The operating date lives on the version itself now.
      date: version.schedule_date ?? "",
      submitterName: profile.full_name ?? profile.email ?? "A scheduler",
      approverId: approverId ?? null,
    });

    return NextResponse.json({ data: { version: updated, published: false } });
  } catch (error) {
    if (error instanceof PublishBlockedError) {
      return NextResponse.json({ error: error.message, ...(error.payload as object) }, { status: error.status });
    }
    console.error("Schedule submit error:", error);
    const message = error instanceof Error ? error.message : "Failed to submit schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

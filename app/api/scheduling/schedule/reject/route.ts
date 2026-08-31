import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";

const rejectSchema = z.object({
  scheduleVersionId: z.string().uuid(),
  reason: z.string().trim().min(1, "A rejection reason is required"),
});

// APR-003/APR-006: rejecting requires the Approve permission, and a reason is
// required. Enforced server-side (APR-012), not just hidden UI.
//
// This used to gate on the legacy user_profile.is_schedule_approver flag from
// the original single-approver design (BR-002), while approve/route.ts already
// used the Approve permission (#2). The mismatch meant a user granted Approve
// could approve a day but not reject it. Both paths now use the permission.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.APPROVE)) {
      return NextResponse.json(
        { error: "You don't have permission to reject a schedule" },
        { status: 403 },
      );
    }

    const admin = await createAdminServerClient();

    const parsed = rejectSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { scheduleVersionId, reason } = parsed.data;

    const { data: version, error: versionError } = await admin
      .from("schedule_versions")
      .select("*")
      .eq("id", scheduleVersionId)
      .single();
    if (versionError || !version) {
      return NextResponse.json({ error: "Schedule version not found" }, { status: 404 });
    }
    if (version.status !== "pending_approval") {
      return NextResponse.json(
        { error: `Cannot reject a version with status ${version.status}` },
        { status: 409 },
      );
    }

    const { data: updated, error: updateError } = await admin
      .from("schedule_versions")
      .update({
        status: "rejected",
        decided_by: profile.id,
        decided_at: new Date().toISOString(),
        decision: "rejected",
        decision_comment: reason,
      })
      .eq("id", scheduleVersionId)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "version_rejected",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: scheduleVersionId,
      after_value: { comment: reason },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Schedule reject error:", error);
    const message = error instanceof Error ? error.message : "Failed to reject schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

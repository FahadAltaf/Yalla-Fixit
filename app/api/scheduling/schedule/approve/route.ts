import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";
import { publishVersionToFsm, PublishBlockedError } from "@/lib/server/publish-schedule";

const approveSchema = z.object({
  scheduleVersionId: z.string().uuid(),
  comment: z.string().trim().optional().nullable(),
});

// APR-009/SYNC-003/SYNC-005: approval writes the drafted work to Zoho FSM.
// This is one of two entry points to the shared publish helper -- the other is
// the "no approval needed" submit path (E1).
export async function POST(req: NextRequest) {
  const admin = await createAdminServerClient();

  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // APR-003/APR-012: enforced server-side via the Approve permission (#2).
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.APPROVE)) {
      return NextResponse.json({ error: "You don't have permission to approve a schedule" }, { status: 403 });
    }

    const parsed = approveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { scheduleVersionId, comment } = parsed.data;

    const { data: version, error: versionError } = await admin
      .from("schedule_versions")
      .select("id, status")
      .eq("id", scheduleVersionId)
      .single();
    if (versionError || !version) {
      return NextResponse.json({ error: "Schedule version not found" }, { status: 404 });
    }
    if (version.status !== "pending_approval") {
      return NextResponse.json(
        { error: `Cannot approve a version with status ${version.status}` },
        { status: 409 },
      );
    }

    await admin.from("schedule_approval_actions").insert({
      schedule_version_id: scheduleVersionId,
      action: "approved",
      actor_id: profile.id,
      comment: comment || null,
    });

    const { version: updated, results } = await publishVersionToFsm(admin, scheduleVersionId, profile.id, {
      comment,
    });

    return NextResponse.json({ data: { version: updated, results } });
  } catch (error) {
    if (error instanceof PublishBlockedError) {
      return NextResponse.json({ error: error.message, ...(error.payload as object) }, { status: error.status });
    }
    console.error("Schedule approve error:", error);
    const message = error instanceof Error ? error.message : "Failed to approve schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

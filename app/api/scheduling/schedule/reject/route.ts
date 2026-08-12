import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

const rejectSchema = z.object({
  scheduleVersionId: z.string().uuid(),
  reason: z.string().trim().min(1, "A rejection reason is required"),
});

// APR-003/APR-006: only Behrouz's configured identity may reject, and a
// reason is required. Enforced server-side (APR-012), not just hidden UI.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = await createAdminServerClient();
    const { data: approverRow, error: approverError } = await admin
      .from("user_profile")
      .select("id")
      .eq("id", profile.id)
      .eq("is_schedule_approver", true)
      .maybeSingle();
    if (approverError) throw new Error(approverError.message);
    if (!approverRow) {
      return NextResponse.json(
        { error: "Only the configured schedule approver may reject a day" },
        { status: 403 },
      );
    }

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

    await admin.from("schedule_approval_actions").insert({
      schedule_version_id: scheduleVersionId,
      action: "rejected",
      actor_id: profile.id,
      comment: reason,
    });

    await admin.from("schedule_audit_events").insert({
      event_type: "version_rejected",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: scheduleVersionId,
      after_value: { reason },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Schedule reject error:", error);
    const message = error instanceof Error ? error.message : "Failed to reject schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

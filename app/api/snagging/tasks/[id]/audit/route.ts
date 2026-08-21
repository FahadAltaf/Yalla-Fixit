import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The audit trail for one inspection (BR-5, §5.3).
 *
 * Read-only; the events themselves are written append-only by
 * recordAudit as approvals, rejections, rounds, visits and deliveries
 * happen.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    const { data, error } = await admin
      .from("snagging_audit_events")
      .select("id, event_type, entity_type, actor_label, origin, justification, payload, created_at")
      .eq("task_id", id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("Snagging audit GET error:", error);
    return NextResponse.json({ error: "Failed to load the audit trail" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { loadJobSnag } from "@/lib/server/snagging/job-detail-sections";
import { ActionType, ResourceType } from "@/types/types";

/**
 * GET /api/snagging/tasks/[id]/snags/[snagId] -- one snag in full (photos
 * signed, who recorded and verified it), as the job viewing it shows it.
 * For the snag detail opened from the plan, where the page holds only the
 * light summary.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; snagId: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id, snagId } = await ctx.params;
    const admin = await createAdminServerClient();
    const snag = await loadJobSnag(admin, id, snagId);
    if (!snag) return NextResponse.json({ error: "Snag not found" }, { status: 404 });
    return NextResponse.json({ data: snag });
  } catch (error) {
    console.error("Snagging snag GET error:", error);
    return NextResponse.json({ error: "Failed to load the snag" }, { status: 500 });
  }
}

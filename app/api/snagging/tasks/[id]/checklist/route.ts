import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { loadJobChecklist } from "@/lib/server/snagging/job-detail-sections";
import { ActionType, ResourceType } from "@/types/types";

/**
 * GET /api/snagging/tasks/[id]/checklist -- the job's checklist, in creation order.
 *
 * One section of the job detail, fetched on its own so it renders as soon
 * as it arrives and a failure here cannot take another section down. See
 * lib/server/snagging/job-detail-sections.ts.
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

    return NextResponse.json({ data: await loadJobChecklist(admin, id) });
  } catch (error) {
    console.error("Snagging task checklist GET error:", error);
    return NextResponse.json({ error: "Failed to load the checklist" }, { status: 500 });
  }
}

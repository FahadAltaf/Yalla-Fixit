import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { cacheHeaders, countJobs, PIPELINE_STAGES } from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * How much work is sitting at each stage of the pipeline.
 *
 * One COUNT(*) per stage, issued together. Six round trips beats pulling
 * every job back to tally statuses in the browser, and stays flat as the
 * table grows.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    const counts = await Promise.all(
      PIPELINE_STAGES.map((stage) => countJobs(admin, (q) => q.eq("status", stage.status))),
    );

    return NextResponse.json(
      {
        data: {
          stages: PIPELINE_STAGES.map((stage, index) => ({
            status: stage.status,
            label: stage.label,
            count: counts[index],
          })),
        },
      },
      { headers: cacheHeaders(60) },
    );
  } catch (error) {
    console.error("Snagging pipeline error:", error);
    return NextResponse.json({ error: "Failed to load the pipeline" }, { status: 500 });
  }
}

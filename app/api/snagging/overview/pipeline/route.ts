import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  PIPELINE_STAGES,
  cacheHeaders,
  countJobs,
  myJobs,
  resolvePeriod,
} from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * How much work is sitting at each stage of the pipeline.
 *
 * One COUNT(*) per stage, issued together. Six round trips beats pulling
 * every job back to tally statuses in the browser, and stays flat as the
 * table grows.
 *
 * Counted over the window the page is being read through (`?days=`), on
 * when the job was RAISED. A pipeline is a picture of a period's intake
 * moving through the stages; counting every job ever raised would make
 * the chart a monument that barely moves, and the date range above it a
 * control that did nothing here.
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

    const period = resolvePeriod(req.nextUrl.searchParams.get("days"));

    const admin = await createAdminServerClient();
    const counts = await Promise.all(
      PIPELINE_STAGES.map((stage) =>
        // The reader's own pipeline (FR-10.01), over the chosen window.
        countJobs(admin, (q) =>
          myJobs(q, profile.id)
            .eq("status", stage.status)
            .gte("created_at", period.fromTs),
        ),
      ),
    );

    return NextResponse.json(
      {
        data: {
          stages: PIPELINE_STAGES.map((stage, index) => ({
            status: stage.status,
            label: stage.label,
            count: counts[index],
          })),
          periodDays: period.days,
        },
      },
      { headers: cacheHeaders(60) },
    );
  } catch (error) {
    console.error("Snagging pipeline error:", error);
    return NextResponse.json(
      { error: "Failed to load the pipeline" },
      { status: 500 },
    );
  }
}

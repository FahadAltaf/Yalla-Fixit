import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Inspector availability for a given day (FR-3.08).
 *
 * Returns which inspectors already have an active inspection on that date, so
 * the assignment UI can flag a clash before it is saved. The tasks PATCH route
 * enforces the same rule server-side — this endpoint is only to surface it.
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

    const date = req.nextUrl.searchParams.get("date");
    const excludeJobId = req.nextUrl.searchParams.get("excludeJobId");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    let query = admin
      .from("snagging_jobs")
      .select("id, code, inspector_id")
      .eq("scheduled_date", date)
      .in("status", ["assigned", "in_progress"])
      .not("inspector_id", "is", null);
    if (excludeJobId) query = query.neq("id", excludeJobId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // inspector_id -> the code of the inspection that makes them busy that day.
    const busy = (data ?? []).reduce<Record<string, string>>((acc, row) => {
      const insp = (row as { inspector_id: string | null; code: string }).inspector_id;
      if (insp) acc[insp] = (row as { code: string }).code;
      return acc;
    }, {});

    return NextResponse.json({ data: { date, busy } });
  } catch (error) {
    console.error("Snagging availability GET error:", error);
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }
}

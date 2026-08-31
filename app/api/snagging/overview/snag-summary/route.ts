import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  countSnags,
  OPEN_SNAG_STATUSES,
  RESOLVED_SNAG_STATUSES,
} from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/** Total / open / resolved / reopened, counted in Postgres. */
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
    const [total, open, resolved, reopened] = await Promise.all([
      countSnags(admin),
      countSnags(admin, (q) => q.in("status", OPEN_SNAG_STATUSES)),
      countSnags(admin, (q) => q.in("status", RESOLVED_SNAG_STATUSES)),
      // A defect the developer said was fixed and the inspector found was
      // not: the one number here that means somebody has to go back.
      countSnags(admin, (q) => q.in("status", ["verified_poor_quality", "verified_not_done"])),
    ]);

    return NextResponse.json(
      { data: { total, open, resolved, reopened } },
      { headers: cacheHeaders(120) },
    );
  } catch (error) {
    console.error("Snag summary error:", error);
    return NextResponse.json({ error: "Failed to load the snag summary" }, { status: 500 });
  }
}

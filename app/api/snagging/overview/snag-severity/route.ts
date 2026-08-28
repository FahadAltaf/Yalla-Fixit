import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  countSnags,
  OPEN_SNAG_STATUSES,
} from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

const LEVELS = ["high", "medium", "low"] as const;

/**
 * Open snags by severity.
 *
 * Scoped to what is still outstanding: a severity split that counts
 * closed defects describes history, not the work in front of anyone.
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
      LEVELS.map((severity) =>
        countSnags(admin, (q) => q.eq("severity", severity).in("status", OPEN_SNAG_STATUSES)),
      ),
    );

    return NextResponse.json(
      {
        data: {
          total: counts.reduce((sum, value) => sum + value, 0),
          levels: LEVELS.map((severity, index) => ({ severity, count: counts[index] })),
        },
      },
      { headers: cacheHeaders(600) },
    );
  } catch (error) {
    console.error("Snag severity error:", error);
    return NextResponse.json({ error: "Failed to load the severity split" }, { status: 500 });
  }
}

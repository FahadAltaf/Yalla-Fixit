import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { listSnaggingStaff } from "@/lib/server/snagging/staff";
import { ActionType, ResourceType } from "@/types/types";

/**
 * GET /api/snagging/staff -- the people snagging work can be given to.
 *
 * Feeds every staff picker in the module (inspectors, approval manager,
 * reviewer). Only people with access to Snagging are listed: see
 * lib/server/snagging/staff for why, and for what "access" means.
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
    return NextResponse.json({ data: await listSnaggingStaff(admin) });
  } catch (error) {
    console.error("Snagging staff GET error:", error);
    return NextResponse.json({ error: "Failed to load the staff list" }, { status: 500 });
  }
}

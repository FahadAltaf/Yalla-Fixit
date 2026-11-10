import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { listNotAsQuotedJobs } from "@/lib/server/snagging/quotation-void";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The jobs held up because the property is not as quoted (SNG-100): their
 * quotation is void and no revised one has been approved yet. The jobs
 * list shows them above the table, in the words the job page uses.
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
    return NextResponse.json({ data: await listNotAsQuotedJobs(admin) });
  } catch (error) {
    console.error("Not-as-quoted jobs GET error:", error);
    return NextResponse.json({ error: "Failed to load the jobs not as quoted" }, { status: 500 });
  }
}

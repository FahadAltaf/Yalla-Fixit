import { NextRequest, NextResponse } from "next/server";

import { isAdminUser } from "@/lib/role-permissions";
import { listAmcSettingsHistory } from "@/lib/server/amc/audit";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * AMC Settings change history, a page at a time (FR6.5, UAT AMC-097).
 *
 * GET ?page=0&pageSize=20 -> { items, total }, newest first. Admins only,
 * like the settings page it belongs to.
 */
export async function GET(req: NextRequest) {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUser(access.accessUser)) {
    return NextResponse.json({ error: "Only an administrator can see the AMC settings history" }, { status: 403 });
  }

  try {
    const params = req.nextUrl.searchParams;
    const admin = await createAdminServerClient();
    const history = await listAmcSettingsHistory(admin, {
      page: Number(params.get("page")) || 0,
      pageSize: Number(params.get("pageSize")) || 20,
    });
    return NextResponse.json(history);
  } catch (error) {
    console.error("AMC settings history GET error:", error);
    return NextResponse.json({ error: "Failed to load the change history" }, { status: 500 });
  }
}

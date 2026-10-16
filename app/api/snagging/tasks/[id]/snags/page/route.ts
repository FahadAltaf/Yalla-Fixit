import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { loadJobSnagPage } from "@/lib/server/snagging/job-detail-sections";
import { ActionType, ResourceType } from "@/types/types";

const SEVERITIES = new Set(["high", "medium", "low"]);
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/snagging/tasks/[id]/snags/page -- one page of the job's snag list.
 *
 * Query: page (from 0), pageSize, scope (own | context), severity, status,
 * source (walk | a visit id), area, sort (newest | oldest). Filtered,
 * sorted and cut in the database; only the page's photos are signed.
 * Returns the rows, the total under the filters and the list's facets.
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
    const params = new URL(req.url).searchParams;
    const text = (key: string) => params.get(key)?.trim() || null;
    const severity = text("severity");
    const status = text("status");

    const admin = await createAdminServerClient();
    const data = await loadJobSnagPage(admin, id, {
      page: Math.max(0, Math.floor(Number(params.get("page")) || 0)),
      pageSize: Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Math.floor(Number(params.get("pageSize")) || 10)),
      ),
      scope: params.get("scope") === "context" ? "context" : "own",
      severity: severity && SEVERITIES.has(severity) ? severity : null,
      // Statuses are short identifiers; anything else is not one.
      status: status && /^[a-z_]{1,40}$/.test(status) ? status : null,
      source: text("source"),
      areaId: text("area"),
      sort: params.get("sort") === "oldest" ? "oldest" : "newest",
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Snagging snag page GET error:", error);
    return NextResponse.json({ error: "Failed to load the snags" }, { status: 500 });
  }
}

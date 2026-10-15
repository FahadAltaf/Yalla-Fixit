import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { loadChangeHistory } from "@/lib/server/snagging/change-history";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The change history of a quotation (`?scope=quotation&id=`) or of the
 * Snagging settings (`?scope=settings`), newest first (SNG-037), a page at
 * a time (`&page=&pageSize=`), with the total for the pager.
 *
 * Read-only; the events are written by the routes that make the changes.
 * Settings history follows the settings' own permission, the quotation's
 * follows Snagging view.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const scope = url.searchParams.get("scope");
    if (scope !== "quotation" && scope !== "settings") {
      return NextResponse.json({ error: "Unknown history" }, { status: 400 });
    }
    const resource =
      scope === "settings" ? ResourceType.SNAGGING_CATALOGUE : ResourceType.SNAGGING;
    if (!hasResourceAction(accessUser, resource, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = url.searchParams.get("id") ?? undefined;
    if (scope === "quotation" && !id) {
      return NextResponse.json({ error: "Which quotation?" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { items, total } = await loadChangeHistory(admin, scope, {
      id,
      page: Number(url.searchParams.get("page")) || 0,
      pageSize: Number(url.searchParams.get("pageSize")) || undefined,
    });
    return NextResponse.json({ data: items, totalCount: total });
  } catch (error) {
    console.error("Snagging history GET error:", error);
    return NextResponse.json({ error: "Failed to load the history" }, { status: 500 });
  }
}

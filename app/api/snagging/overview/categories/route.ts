import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  countSnags,
  legacyElementsFor,
} from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Snags per category, biggest first (FR-10 / restructured catalogue).
 *
 * The categories are read from the catalogue rather than listed here.
 * They are editable rows now — twenty of them today — so a hard-coded
 * list would go stale the first time somebody adds the twenty-first, and
 * the whole point of making every level a row was that it takes no
 * release to change.
 *
 * Each count matches on the leading segment of the snag's catalogue code:
 * `SN03-02-01` is an SN03 defect. Snags captured before the restructure
 * carry the old `AREA-ELEMENT-DEFECT` shape instead, so they are matched
 * on their element segment through LEGACY_ELEMENT_CATEGORY, and the two
 * halves are counted as one figure. That legacy half is temporary and
 * documented where the map lives.
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

    const { data: rows, error } = await admin
      .from("snagging_catalogue_categories")
      .select("code, label")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);

    const catalogue = (rows ?? []) as Array<{ code: string; label: string }>;

    const counts = await Promise.all(
      catalogue.map(({ code }) => {
        // A snag matches its category by the first segment of its code, or
        // — while old snags are still on the system — by the element in the
        // middle segment of the shape that preceded it.
        const patterns = [
          `catalogue_code.like.${code}-*`,
          ...legacyElementsFor(code).map(
            (element) => `catalogue_code.like.*-${element}-*`,
          ),
        ];
        return countSnags(admin, (q) => q.or(patterns.join(",")));
      }),
    );

    const categories = catalogue
      .map(({ code, label }, index) => ({
        code,
        category: label,
        count: counts[index],
        // Kept so the client can still say out loud that a zero means
        // "nothing has landed here yet" rather than "no defects found".
        mapped: true,
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

    return NextResponse.json(
      {
        data: {
          total: counts.reduce((sum, value) => sum + value, 0),
          categories,
        },
      },
      { headers: cacheHeaders(600) },
    );
  } catch (error) {
    console.error("Snags by category error:", error);
    return NextResponse.json({ error: "Failed to load the category breakdown" }, { status: 500 });
  }
}

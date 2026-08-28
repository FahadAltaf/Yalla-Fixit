import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  CATEGORY_ELEMENTS,
  countSnags,
} from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Snags per trade category, biggest first (FR-10 / BRD v7 catalogue).
 *
 * One COUNT(*) per category. The catalogue code reads AREA-ELEMENT-DEFECT,
 * so each category matches on its element codes in the middle segment —
 * see CATEGORY_ELEMENTS for why the mapping lives there and what changes
 * when the restructured catalogue lands.
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
      CATEGORY_ELEMENTS.map(({ elements }) => {
        if (elements.length === 0) return Promise.resolve(0);
        const patterns = elements.map((code) => `catalogue_code.like.*-${code}-*`).join(",");
        return countSnags(admin, (q) => q.or(patterns));
      }),
    );

    const categories = CATEGORY_ELEMENTS.map(({ category, elements }, index) => ({
      category,
      count: counts[index],
      // Says out loud that a zero is "nothing maps here yet" rather than
      // "no defects found", which are very different facts.
      mapped: elements.length > 0,
    })).sort((a, b) => b.count - a.count);

    return NextResponse.json(
      { data: { total: counts.reduce((sum, value) => sum + value, 0), categories } },
      { headers: cacheHeaders(600) },
    );
  } catch (error) {
    console.error("Snags by category error:", error);
    return NextResponse.json({ error: "Failed to load the category breakdown" }, { status: 500 });
  }
}

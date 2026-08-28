import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { cacheHeaders } from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The quotation funnel: generated, sent, approved, rejected, awaiting.
 *
 * Counted in Postgres, one head query per stage. "Generated" is every
 * quotation ever raised, so the later stages read as a funnel out of it
 * rather than as five unrelated tallies.
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
    const count = async (refine?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
      const query = base();
      const { count: value, error } = await (refine ? refine(query) : query);
      if (error) throw new Error(error.message);
      return value ?? 0;
    };
    function base() {
      return admin.from("snagging_quotations").select("id", { count: "exact", head: true });
    }

    const [generated, sent, approved, rejected, awaiting] = await Promise.all([
      count(),
      count((q) => q.in("status", ["sent", "approved", "rejected"])),
      count((q) => q.eq("status", "approved")),
      count((q) => q.eq("status", "rejected")),
      count((q) => q.eq("status", "sent")),
    ]);

    // Of the quotations the client actually answered, how many said yes.
    // Measuring against everything sent would let the figure drift down
    // simply because a quote went out this morning.
    const decided = approved + rejected;

    return NextResponse.json(
      {
        data: {
          stages: [
            { key: "generated", label: "Generated", count: generated },
            { key: "sent", label: "Sent", count: sent },
            { key: "approved", label: "Approved", count: approved },
            { key: "rejected", label: "Rejected", count: rejected },
            { key: "awaiting", label: "Awaiting", count: awaiting },
          ],
          approvalRate: decided === 0 ? null : Math.round((approved / decided) * 100),
          decided,
        },
      },
      { headers: cacheHeaders(600) },
    );
  } catch (error) {
    console.error("Quotation analytics error:", error);
    return NextResponse.json({ error: "Failed to load quotation analytics" }, { status: 500 });
  }
}

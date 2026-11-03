import { NextRequest, NextResponse } from "next/server";

import { monthEndRevenue } from "@/lib/server/finance/revenue";
import { requireResourceAccess } from "@/lib/server/require-access";
import { todayInZone } from "@/lib/scheduling/org-time";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Revenue at month end (26 Oct, change 7): recognised, invoiced and still
 * to invoice per work order as of the last day of ?month=YYYY-MM (this
 * month unless given), from the portal's records only. Finance queue View.
 */

export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.FINANCE_METRICS, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  const month = req.nextUrl.searchParams.get("month") ?? todayInZone().slice(0, 7);
  if (!MONTH.test(month)) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json({ data: await monthEndRevenue(admin, month) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/line_states|work_order_states|line_invoices|PGRST205|42P01|schema cache/i.test(message)) {
      return NextResponse.json({ error: "Revenue at month end is not set up yet: a database update is still to be applied." }, { status: 409 });
    }
    console.error("Month-end revenue error:", error);
    return NextResponse.json({ error: "Could not work out the revenue" }, { status: 500 });
  }
}

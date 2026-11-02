import { NextRequest } from "next/server";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { reminderList } from "@/lib/server/compliance/employees";
import { complianceToday, ok, serverError } from "@/lib/server/compliance/http";
import type { ComplianceItemStatus } from "@/lib/compliance/status";

/*
  Expiry reminder list (FRD FR-7): every Due, Expired or Missing-expiry item
  for active manpower, derived from the records, sorted by days remaining.
  ?item=emirates_id|passport|certificates|cert:<id>  ?status=  ?site=<clientId>|unassigned
*/
export async function GET(req: NextRequest) {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    const p = req.nextUrl.searchParams;
    const today = complianceToday();
    const rows = await reminderList(
      admin,
      {
        itemKey: p.get("item") ?? undefined,
        status: (p.get("status") ?? "") as ComplianceItemStatus | "",
        siteClientId: p.get("site") ?? undefined,
      },
      today,
    );
    return ok({ rows, as_of: today });
  } catch (error) {
    return serverError("reminder list", error);
  }
}

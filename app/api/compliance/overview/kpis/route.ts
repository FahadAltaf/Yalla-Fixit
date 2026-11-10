import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { overviewKpis } from "@/lib/server/compliance/employees";
import { complianceToday, ok, serverError } from "@/lib/server/compliance/http";

/* Dashboard KPIs (FRD FR-5): totals and Emirates ID / passport counts by status, active manpower only. */
export async function GET() {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    return ok(await overviewKpis(admin, complianceToday()));
  } catch (error) {
    return serverError("overview kpis", error);
  }
}

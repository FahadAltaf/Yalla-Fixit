import type { Metadata } from "next";

import NewEmployee from "@/components/dashboard/compliance/new-employee";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeCompliancePage } from "@/lib/server/compliance/access";
import { LIST_ROSTER_MAX_AGE_MS, refreshRosterIfOlderThan } from "@/lib/server/compliance/roster";
import { ActionType, ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "New employee | Manpower Compliance",
  robots: { index: false, follow: false },
};

export default async function NewComplianceEmployeePage() {
  if (!(await canSeeCompliancePage(ResourceType.COMPLIANCE, ActionType.CREATE))) return <NoPageAccess page="creating compliance employees" />;
  // Same six-hour FSM roster refresh the scheduling pages do, so the technician
  // link and the D11 "inactive since" note are as fresh here as there. Never throws.
  await refreshRosterIfOlderThan(LIST_ROSTER_MAX_AGE_MS);
  return <NewEmployee />;
}

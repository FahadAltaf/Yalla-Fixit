import type { Metadata } from "next";

import ComplianceOverviewDashboard from "@/components/dashboard/compliance/overview-dashboard";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeCompliancePage } from "@/lib/server/compliance/access";
import { LIST_ROSTER_MAX_AGE_MS, refreshRosterIfOlderThan } from "@/lib/server/compliance/roster";

export const metadata: Metadata = {
  title: "Overview | Manpower Compliance",
  description: "Emirates ID, passport and training compliance for YFI staff.",
  robots: { index: false, follow: false },
};

export default async function CompliancePage() {
  if (!(await canSeeCompliancePage())) return <NoPageAccess page="Compliance" />;
  // Same six-hour FSM roster refresh the scheduling pages do, so the technician
  // link and the D11 "inactive since" note are as fresh here as there. Never throws.
  await refreshRosterIfOlderThan(LIST_ROSTER_MAX_AGE_MS);
  return <ComplianceOverviewDashboard />;
}

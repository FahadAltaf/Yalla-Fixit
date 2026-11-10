import type { Metadata } from "next";

import EmployeeRecordView from "@/components/dashboard/compliance/employee-record";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeCompliancePage } from "@/lib/server/compliance/access";
import { RECORD_ROSTER_MAX_AGE_MS, refreshRosterIfOlderThan } from "@/lib/server/compliance/roster";

export const metadata: Metadata = {
  title: "Employee | Manpower Compliance",
  robots: { index: false, follow: false },
};

export default async function ComplianceEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canSeeCompliancePage())) return <NoPageAccess page="Compliance employees" />;
  // D11: a record is never more than 15 minutes behind FSM. Never throws.
  await refreshRosterIfOlderThan(RECORD_ROSTER_MAX_AGE_MS);
  const { id } = await params;
  return <EmployeeRecordView id={id} />;
}

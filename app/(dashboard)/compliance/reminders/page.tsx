import type { Metadata } from "next";
import { Suspense } from "react";

import RemindersAdmin from "@/components/dashboard/compliance/reminders-admin";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeCompliancePage } from "@/lib/server/compliance/access";

export const metadata: Metadata = {
  title: "Expiry reminders | Manpower Compliance",
  description: "Documents and certificates that are due, expired or missing a date.",
  robots: { index: false, follow: false },
};

export default async function ComplianceRemindersPage() {
  if (!(await canSeeCompliancePage())) return <NoPageAccess page="Expiry reminders" />;
  return (
    <Suspense fallback={null}>
      <RemindersAdmin />
    </Suspense>
  );
}

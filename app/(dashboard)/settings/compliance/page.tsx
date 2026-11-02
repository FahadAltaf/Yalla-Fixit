import type { Metadata } from "next";
import { Suspense } from "react";

import SettingsAdmin from "@/components/dashboard/compliance/settings-admin";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeCompliancePage } from "@/lib/server/compliance/access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Compliance settings | Settings",
  robots: { index: false, follow: false },
};

/**
 * Manpower Compliance configuration, under Settings with the rest of the
 * admin configuration rather than under Compliance beside the records.
 */
export default async function ComplianceSettingsPage() {
  if (!(await canSeeCompliancePage(ResourceType.COMPLIANCE_SETTINGS))) return <NoPageAccess page="Compliance settings" />;
  return (
    <Suspense fallback={null}>
      <SettingsAdmin />
    </Suspense>
  );
}

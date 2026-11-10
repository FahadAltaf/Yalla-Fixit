import { Suspense } from "react";
import type { Metadata } from "next";

import { CompliancePage } from "@/components/dashboard/reports/compliance-page";

export const metadata: Metadata = {
  title: "App compliance | Reports",
  robots: { index: false, follow: false },
};

/* App usage compliance (BRD 5.2 B4). The API checks Compliance View. Suspense: the page reads its link's filters. */
export default function ComplianceRoute() {
  return (
    <Suspense>
      <CompliancePage />
    </Suspense>
  );
}

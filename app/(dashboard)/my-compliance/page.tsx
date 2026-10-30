import { Suspense } from "react";
import type { Metadata } from "next";

import { MyCompliancePage } from "@/components/dashboard/reports/my-compliance-page";

export const metadata: Metadata = {
  title: "My compliance",
  robots: { index: false, follow: false },
};

/* A technician's own compliance (BRD §6.7). The API finds the technician from the signed-in account. */
export default function MyComplianceRoute() {
  return (
    <Suspense>
      <MyCompliancePage />
    </Suspense>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MyCompliancePage } from "@/components/dashboard/reports/my-compliance-page";
import { REPORTS_ENABLED } from "@/lib/reports/enabled";

export const metadata: Metadata = {
  title: "My compliance",
  robots: { index: false, follow: false },
};

/* A technician's own compliance (BRD §6.7). The API finds the technician from the signed-in account. */
export default function MyComplianceRoute() {
  /* Part of the Reports module: hidden while it is switched off (lib/reports/enabled.ts). */
  if (!REPORTS_ENABLED) notFound();
  return (
    <Suspense>
      <MyCompliancePage />
    </Suspense>
  );
}

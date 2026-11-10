import { Suspense } from "react";
import type { Metadata } from "next";

import { UtilizationPage } from "@/components/dashboard/reports/utilization-page";

export const metadata: Metadata = {
  title: "Utilization | Reports",
  robots: { index: false, follow: false },
};

/* Technician utilization (BRD 5.2 B2). The API checks Utilization View. Suspense: the page reads its link's filters. */
export default function UtilizationRoute() {
  return (
    <Suspense>
      <UtilizationPage />
    </Suspense>
  );
}

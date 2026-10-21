import { Suspense } from "react";
import type { Metadata } from "next";

import { CapacityPage } from "@/components/dashboard/reports/capacity-page";

export const metadata: Metadata = {
  title: "Capacity | Reports",
  robots: { index: false, follow: false },
};

/* Forward capacity (BRD 5.2 B5). The API checks Capacity View. Suspense: the page reads its link's filters. */
export default function CapacityRoute() {
  return (
    <Suspense>
      <CapacityPage />
    </Suspense>
  );
}

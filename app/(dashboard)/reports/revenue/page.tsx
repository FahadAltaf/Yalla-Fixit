import { Suspense } from "react";
import type { Metadata } from "next";

import { RevenuePage } from "@/components/dashboard/reports/revenue-page";

export const metadata: Metadata = {
  title: "Revenue | Reports",
  robots: { index: false, follow: false },
};

/* Revenue (BRD 5.2 B5; DEV-454). The API checks Revenue View. Suspense: the page reads its link's filters. */
export default function RevenueRoute() {
  return (
    <Suspense>
      <RevenuePage />
    </Suspense>
  );
}

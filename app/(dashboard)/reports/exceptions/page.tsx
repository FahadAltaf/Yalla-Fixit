import { Suspense } from "react";
import type { Metadata } from "next";

import { ExceptionsPage } from "@/components/dashboard/reports/exceptions-page";

export const metadata: Metadata = {
  title: "Exception reports | Reports",
  robots: { index: false, follow: false },
};

/* The exception reports (BRD 5.2 B5). The API checks Exception reports View. Suspense: the page reads its link's filters. */
export default function ExceptionsRoute() {
  return (
    <Suspense>
      <ExceptionsPage />
    </Suspense>
  );
}

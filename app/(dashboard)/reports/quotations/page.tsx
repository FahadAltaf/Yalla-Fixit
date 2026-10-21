import { Suspense } from "react";
import type { Metadata } from "next";

import { QuotationSummaryPage } from "@/components/dashboard/reports/quotation-summary-page";

export const metadata: Metadata = {
  title: "Quotation summary | Reports",
  robots: { index: false, follow: false },
};

/* The quotation summary (BRD 5.2 B1). The API checks Quotation summary View. Suspense: the page reads its link's filters. */
export default function QuotationSummaryRoute() {
  return (
    <Suspense>
      <QuotationSummaryPage />
    </Suspense>
  );
}

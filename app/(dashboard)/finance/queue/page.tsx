import { Suspense } from "react";
import type { Metadata } from "next";

import { FinanceWorkOrdersPage } from "@/components/dashboard/finance/work-orders-page";

export const metadata: Metadata = {
  title: "Ready to invoice | Finance",
  robots: { index: false, follow: false },
};

/* Ready to invoice (BRD 6.4): FSM work orders read live from Zoho FSM. The API checks Finance queue View. Suspense: the filters live in the URL. */
export default function FinanceQueueRoute() {
  return (
    <Suspense>
      <FinanceWorkOrdersPage />
    </Suspense>
  );
}

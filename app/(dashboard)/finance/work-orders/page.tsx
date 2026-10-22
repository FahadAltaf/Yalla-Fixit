import { Suspense } from "react";
import type { Metadata } from "next";

import { FinanceWorkOrdersPage } from "@/components/dashboard/finance/work-orders-page";

export const metadata: Metadata = {
  title: "Work orders | Finance",
  robots: { index: false, follow: false },
};

/* Work orders for invoicing, from the FSM copy. The API checks Finance queue View. Suspense: the filters live in the URL. */
export default function FinanceWorkOrdersRoute() {
  return (
    <Suspense>
      <FinanceWorkOrdersPage />
    </Suspense>
  );
}

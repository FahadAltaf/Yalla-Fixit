import { Suspense } from "react";
import type { Metadata } from "next";

import { FinanceWorkOrdersPage } from "@/components/dashboard/finance/work-orders-page";

export const metadata: Metadata = {
  title: "Ready to invoice (Operations) | Finance",
  robots: { index: false, follow: false },
};

/* Operations' view of Ready to invoice (3 Nov): its own menu entry for anyone who also holds Finance's. The API checks the view may be seen. */
export default function FinanceOperationsRoute() {
  return (
    <Suspense>
      <FinanceWorkOrdersPage view="operations" />
    </Suspense>
  );
}

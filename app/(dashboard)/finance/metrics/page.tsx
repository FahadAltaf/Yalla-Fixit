import type { Metadata } from "next";

import { FinanceMetricsPage } from "@/components/dashboard/finance/metrics-page";

export const metadata: Metadata = {
  title: "Invoicing metrics | Finance",
  robots: { index: false, follow: false },
};

/* Invoicing controls (BRD §5.1 Step 8, §6.9). */
export default function FinanceMetricsRoute() {
  return <FinanceMetricsPage />;
}

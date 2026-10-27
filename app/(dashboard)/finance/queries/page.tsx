import type { Metadata } from "next";

import { FinanceQueriesPage } from "@/components/dashboard/finance/queries-page";

export const metadata: Metadata = {
  title: "Queries | Finance",
  robots: { index: false, follow: false },
};

/* The coordinators' query dashboard (26 Oct, change 9). The API checks who may see and answer. */
export default function FinanceQueriesRoute() {
  return <FinanceQueriesPage />;
}

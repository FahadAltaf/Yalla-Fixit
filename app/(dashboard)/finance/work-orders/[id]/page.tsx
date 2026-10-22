import type { Metadata } from "next";

import { FinanceWorkOrderPage } from "@/components/dashboard/finance/work-order-page";

export const metadata: Metadata = {
  title: "Work order | Finance",
  robots: { index: false, follow: false },
};

/* One work order for invoicing; its lines are read from FSM when out of date. The API checks the permission. */
export default async function FinanceWorkOrderRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceWorkOrderPage id={id} />;
}

import type { Metadata } from "next";

import { FinanceQueueItemPage } from "@/components/dashboard/finance/queue-item-page";

export const metadata: Metadata = {
  title: "Queue item | Finance",
  robots: { index: false, follow: false },
};

/* One Ready-to-Invoice item (BRD §5.1 Step 3). The API decides what the
   caller may see and do. */
export default async function FinanceQueueItemRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceQueueItemPage id={id} />;
}

import { Suspense } from "react";
import type { Metadata } from "next";

import { FinanceQueueItemPage } from "@/components/dashboard/finance/queue-item-page";
import { FinanceWorkOrderPage } from "@/components/dashboard/finance/work-order-page";

export const metadata: Metadata = {
  title: "Work order | Finance",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* One work order in Ready to invoice (BRD 5.1 Step 3), read live from FSM.
   A UUID is an item of the earlier queue, still opened from its links
   (notifications, digest, metrics). The API decides what the caller may
   see and do. */
export default async function FinanceQueueItemRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return UUID.test(id) ? (
    <FinanceQueueItemPage id={id} />
  ) : (
    <Suspense>
      <FinanceWorkOrderPage id={id} />
    </Suspense>
  );
}

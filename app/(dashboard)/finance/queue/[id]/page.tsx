import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Archive } from "lucide-react";

import { FinanceWorkOrderPage } from "@/components/dashboard/finance/work-order-page";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const metadata: Metadata = {
  title: "Work order | Finance",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* One work order in Ready to invoice (BRD 5.1 Step 3), read live from FSM.
   A UUID is an item of the earlier queue (before 22 Oct). That queue is
   retired (Sami, 9 Nov): its page and its invoice, action, exclusion and
   evidence APIs are gone, so nothing can be invoiced outside Ready to
   invoice. An old link (notification, email) says so and points there. */
export default async function FinanceQueueItemRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (UUID.test(id)) {
    return (
      <Empty className="mx-auto mt-10 max-w-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Archive />
          </EmptyMedia>
          <EmptyTitle>This link is from the earlier invoicing queue</EmptyTitle>
          <EmptyDescription>
            That queue has been replaced by Ready to invoice, where work orders are invoiced line by line. Find the work order there by its number.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild size="sm">
            <Link href="/finance/queue">Open Ready to invoice</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <Suspense>
      <FinanceWorkOrderPage id={id} />
    </Suspense>
  );
}

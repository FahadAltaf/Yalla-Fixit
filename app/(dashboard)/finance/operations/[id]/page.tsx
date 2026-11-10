import type { Metadata } from "next";

import FinanceQueueItemRoute from "../../queue/[id]/page";

export const metadata: Metadata = {
  title: "Work order | Finance",
  robots: { index: false, follow: false },
};

/* A work order opened from Operations' view: the same page as under /finance/queue, so the menu keeps Operations selected (3 Nov). */
export default FinanceQueueItemRoute;

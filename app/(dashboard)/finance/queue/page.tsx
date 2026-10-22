import type { Metadata } from "next";

import { FinanceQueuePage } from "@/components/dashboard/finance/queue-page";

export const metadata: Metadata = {
  title: "Ready to invoice | Finance",
  robots: { index: false, follow: false },
};

/* The Ready-to-Invoice queue (BRD §6.4). The API checks Finance queue View. */
export default async function FinanceQueueRoute({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; aged?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  return <FinanceQueuePage initial={{ status: params.status, aged: params.aged === "1", from: params.from, to: params.to }} />;
}

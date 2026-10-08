import type { Metadata } from "next";

import { CustomerDetail } from "@/components/dashboard/extensions/amc-contracts/customer-property-views";

export const metadata: Metadata = {
  title: "Client | AMC",
  robots: { index: false, follow: false },
};

export default async function Route({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  return <CustomerDetail id={customerId} />;
}

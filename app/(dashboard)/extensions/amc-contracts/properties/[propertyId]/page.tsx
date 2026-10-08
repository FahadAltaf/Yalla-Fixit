import type { Metadata } from "next";

import { PropertyDetail } from "@/components/dashboard/extensions/amc-contracts/customer-property-views";

export const metadata: Metadata = {
  title: "Property | AMC",
  robots: { index: false, follow: false },
};

export default async function Route({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  return <PropertyDetail id={propertyId} />;
}

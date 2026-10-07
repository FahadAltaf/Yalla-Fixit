import type { Metadata } from "next";

import { EnquiryDetail } from "@/components/dashboard/extensions/amc-contracts/enquiries/enquiry-detail";

export const metadata: Metadata = {
  title: "Enquiry | AMC",
  robots: { index: false, follow: false },
};

export default async function Route({ params }: { params: Promise<{ enquiryId: string }> }) {
  const { enquiryId } = await params;
  return <EnquiryDetail id={enquiryId} />;
}

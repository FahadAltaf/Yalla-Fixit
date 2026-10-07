import type { Metadata } from "next";

import { EnquiriesPage } from "@/components/dashboard/extensions/amc-contracts/enquiries/enquiries-page";

export const metadata: Metadata = {
  title: "Enquiries | AMC",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <EnquiriesPage />;
}

import type { Metadata } from "next";

import { PaymentsPage } from "@/components/dashboard/extensions/amc-contracts/payments-page";

export const metadata: Metadata = {
  title: "Payments | AMC",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <PaymentsPage />;
}

import type { Metadata } from "next";

import { CustomersPage } from "@/components/dashboard/extensions/amc-contracts/customers-page";

export const metadata: Metadata = {
  title: "Clients | AMC",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <CustomersPage />;
}

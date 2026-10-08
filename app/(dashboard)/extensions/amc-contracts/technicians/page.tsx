import type { Metadata } from "next";

import { TechniciansPage } from "@/components/dashboard/extensions/amc-contracts/technicians-page";

export const metadata: Metadata = {
  title: "Technicians | AMC",
  robots: { index: false, follow: false },
};

export default function TechniciansRoute() {
  return <TechniciansPage />;
}

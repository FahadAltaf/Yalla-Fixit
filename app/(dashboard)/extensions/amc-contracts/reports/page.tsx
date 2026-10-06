import type { Metadata } from "next";

import { AmcReports } from "@/components/dashboard/extensions/amc-contracts/amc-reports";

export const metadata: Metadata = {
  title: "Reports | AMC contracts",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <AmcReports />;
}

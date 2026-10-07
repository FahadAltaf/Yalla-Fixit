import type { Metadata } from "next";

import { RateCardPage } from "@/components/dashboard/extensions/amc-contracts/rate-card/rate-card-page";

export const metadata: Metadata = {
  title: "Rate card | AMC",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <RateCardPage />;
}

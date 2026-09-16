import type { Metadata } from "next";

import PricingSettings from "@/components/dashboard/snagging/pricing-settings";

export const metadata: Metadata = {
  title: "Snagging settings | Property Care Snagging",
  robots: { index: false, follow: false },
};

export default function SnaggingPricingPage() {
  return <PricingSettings />;
}

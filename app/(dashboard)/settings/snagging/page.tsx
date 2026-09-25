import type { Metadata } from "next";

import PricingSettings from "@/components/dashboard/snagging/pricing-settings";

export const metadata: Metadata = {
  title: "Snagging settings | Property Care Snagging",
  robots: { index: false, follow: false },
};

/**
 * The rate card and quotation wording, under Settings with the rest of the
 * admin configuration rather than under Snagging beside the work it prices.
 *
 * /snagging/pricing still answers and redirects here, for anyone holding
 * the old address.
 */
export default function SnaggingSettingsPage() {
  return <PricingSettings />;
}

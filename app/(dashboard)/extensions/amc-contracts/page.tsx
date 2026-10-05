import type { Metadata } from "next";
import { Suspense } from "react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { AmcContractsPage } from "@/components/dashboard/extensions/amc-contracts/amc-contracts-page";

export const metadata: Metadata = {
  title: "AMC contracts | Extensions",
  description: "Signed AMC agreements in operation: coverage, usage, expiry and renewal.",
  robots: { index: false, follow: false },
};

export default function AmcContractsRoute() {
  // The status filter lives in the query string (?status=), which needs
  // Suspense under the App Router.
  return (
    <Suspense fallback={<HeadingSkeleton />}>
      <AmcContractsPage />
    </Suspense>
  );
}

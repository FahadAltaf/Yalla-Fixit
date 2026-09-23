import type { Metadata } from "next";
import { Suspense } from "react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { AmcWizard } from "@/components/dashboard/extensions/amc";

export const metadata: Metadata = {
  title: "New AMC proposal | Extensions",
  robots: { index: false, follow: false },
};

export default function NewAmcProposalRoute() {
  return (
    <Suspense fallback={<HeadingSkeleton />}>
      <AmcWizard />
    </Suspense>
  );
}

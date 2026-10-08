import type { Metadata } from "next";
import { Suspense } from "react";

import { WizardSkeleton } from "@/components/dashboard/snagging/route-skeletons";
import { AmcWizard } from "@/components/dashboard/extensions/amc";

export const metadata: Metadata = {
  title: "New proposal | AMC",
  robots: { index: false, follow: false },
};

export default function NewAmcProposalRoute() {
  return (
    <Suspense fallback={<WizardSkeleton />}>
      <AmcWizard />
    </Suspense>
  );
}

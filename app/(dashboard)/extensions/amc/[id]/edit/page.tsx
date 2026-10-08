import type { Metadata } from "next";
import { Suspense } from "react";

import { WizardSkeleton } from "@/components/dashboard/snagging/route-skeletons";
import { AmcWizard } from "@/components/dashboard/extensions/amc";

export const metadata: Metadata = {
  title: "Edit proposal | AMC",
  robots: { index: false, follow: false },
};

export default async function EditAmcProposalRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The step is read from ?step=, which needs Suspense.
  return (
    <Suspense fallback={<WizardSkeleton />}>
      <AmcWizard submissionId={id} />
    </Suspense>
  );
}

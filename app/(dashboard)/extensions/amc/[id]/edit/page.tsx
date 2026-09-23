import type { Metadata } from "next";
import { Suspense } from "react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { AmcWizard } from "@/components/dashboard/extensions/amc";

export const metadata: Metadata = {
  title: "Edit AMC proposal | Extensions",
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
    <Suspense fallback={<HeadingSkeleton />}>
      <AmcWizard submissionId={id} />
    </Suspense>
  );
}

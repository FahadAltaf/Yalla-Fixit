import type { Metadata } from "next";

import { AmcSubmissionDetail } from "@/components/dashboard/extensions/amc/amc-submission-detail";

export const metadata: Metadata = {
  title: "AMC proposal | Extensions",
  robots: { index: false, follow: false },
};

export default async function AmcProposalRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AmcSubmissionDetail id={id} />;
}

import type { Metadata } from "next";

import { AmcSubmissionDetail } from "@/components/dashboard/extensions/amc/amc-submission-detail";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Proposal | AMC",
  robots: { index: false, follow: false },
};

export default async function AmcProposalRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_PROPOSALS))) return <NoPageAccess page="Proposals" />;
  const { id } = await params;
  return <AmcSubmissionDetail id={id} />;
}

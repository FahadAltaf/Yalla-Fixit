import type { Metadata } from "next";

import { AssessmentDetail } from "@/components/dashboard/extensions/amc-contracts/assessments";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Site visit | AMC",
  robots: { index: false, follow: false },
};

export default async function Route({ params }: { params: Promise<{ assessmentId: string }> }) {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_SITE_VISITS))) return <NoPageAccess page="Site visits" />;
  const { assessmentId } = await params;
  return <AssessmentDetail id={assessmentId} />;
}

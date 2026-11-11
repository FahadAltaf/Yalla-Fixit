import type { Metadata } from "next";

import { JobReviewsPage } from "@/components/dashboard/extensions/amc-contracts/job-reviews-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Job reviews | AMC",
  robots: { index: false, follow: false },
};

export default async function JobReviewsRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_VISITS))) return <NoPageAccess page="Job reviews" />;
  return <JobReviewsPage />;
}

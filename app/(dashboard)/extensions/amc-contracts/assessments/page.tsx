import type { Metadata } from "next";

import { AssessmentsPage } from "@/components/dashboard/extensions/amc-contracts/assessments";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Site visits | AMC",
  robots: { index: false, follow: false },
};

export default async function Route() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_SITE_VISITS))) return <NoPageAccess page="Site visits" />;
  return <AssessmentsPage />;
}

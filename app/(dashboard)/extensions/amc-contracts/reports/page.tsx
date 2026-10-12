import type { Metadata } from "next";

import { AmcReports } from "@/components/dashboard/extensions/amc-contracts/amc-reports";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Reports | AMC",
  robots: { index: false, follow: false },
};

export default async function Route() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_REPORTS))) return <NoPageAccess page="Reports" />;
  return <AmcReports />;
}

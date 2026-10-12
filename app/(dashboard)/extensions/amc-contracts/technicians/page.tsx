import type { Metadata } from "next";

import { TechniciansPage } from "@/components/dashboard/extensions/amc-contracts/technicians-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Technicians | AMC",
  robots: { index: false, follow: false },
};

export default async function TechniciansRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_TECHNICIANS))) return <NoPageAccess page="Technicians" />;
  return <TechniciansPage />;
}

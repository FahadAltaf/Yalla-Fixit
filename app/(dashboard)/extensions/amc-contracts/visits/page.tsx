import { Suspense } from "react";
import type { Metadata } from "next";

import { VisitsPage } from "@/components/dashboard/extensions/amc-contracts/visits-page";
import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Visits | AMC",
  robots: { index: false, follow: false },
};

/* The filters are read from the address (?kind, ?stage, ?when, ?technician), which needs a Suspense boundary. */
export default async function VisitsRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  /* Site visits live in this list too (11 Nov 2026): either permission opens it. */
  const [visits, siteVisits] = await Promise.all([canSeeAmcPage(ResourceType.AMC_VISITS), canSeeAmcPage(ResourceType.AMC_SITE_VISITS)]);
  if (!visits && !siteVisits) return <NoPageAccess page="Visits" />;
  return (
    <Suspense fallback={<TablePageSkeleton filters={4} columns={6} />}>
      <VisitsPage />
    </Suspense>
  );
}

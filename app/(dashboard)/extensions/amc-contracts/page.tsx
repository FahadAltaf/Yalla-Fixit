import type { Metadata } from "next";
import { Suspense } from "react";

import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";
import { AmcContractsPage } from "@/components/dashboard/extensions/amc-contracts/amc-contracts-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "AMC contracts | Extensions",
  description: "Signed AMC agreements in operation: coverage, usage, expiry and renewal.",
  robots: { index: false, follow: false },
};

export default async function AmcContractsRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_CONTRACTS))) return <NoPageAccess page="Contracts" />;
  // The status filter lives in the query string (?status=), which needs
  // Suspense under the App Router.
  return (
    <Suspense fallback={<TablePageSkeleton filters={2} columns={8} />}>
      <AmcContractsPage />
    </Suspense>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";

import { AdditionalWorksPage } from "@/components/dashboard/extensions/amc-contracts/additional-works-page";
import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Additional work | AMC",
  robots: { index: false, follow: false },
};

/* The page opens a work from ?open=<id>, which needs a Suspense boundary. */
export default async function AdditionalWorksRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_ADDITIONAL_WORKS))) return <NoPageAccess page="Additional work" />;
  return (
    <Suspense fallback={<HeadingSkeleton withActions />}>
      <AdditionalWorksPage />
    </Suspense>
  );
}

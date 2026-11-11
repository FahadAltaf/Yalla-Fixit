import type { Metadata } from "next";
import { Suspense } from "react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { AmcConfigGate } from "@/components/dashboard/extensions/amc/configuration/amc-config-gate";
import { AmcConfigurationPage } from "@/components/dashboard/extensions/amc/configuration/amc-configuration-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "AMC configuration | Settings",
  robots: { index: false, follow: false },
};

/*
  AMC configuration (DEV-419) beside AMC Settings: AMC Configuration View
  opens it; each section says who may change it. The view is kept in
  ?view=, so the page needs Suspense.
*/
export default async function AmcConfigurationRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_CONFIG))) return <NoPageAccess page="AMC configuration" />;
  return (
    <AmcConfigGate>
      <Suspense fallback={<HeadingSkeleton />}>
        <AmcConfigurationPage />
      </Suspense>
    </AmcConfigGate>
  );
}

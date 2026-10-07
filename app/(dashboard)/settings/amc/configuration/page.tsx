import type { Metadata } from "next";
import { Suspense } from "react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { AmcConfigGate } from "@/components/dashboard/extensions/amc/configuration/amc-config-gate";
import { AmcConfigurationPage } from "@/components/dashboard/extensions/amc/configuration/amc-configuration-page";

export const metadata: Metadata = {
  title: "AMC configuration | Settings",
  robots: { index: false, follow: false },
};

/*
  AMC configuration (DEV-419) beside AMC Settings: AMC Configuration View
  opens it; each section says who may change it. The view is kept in
  ?view=, so the page needs Suspense.
*/
export default function AmcConfigurationRoute() {
  return (
    <AmcConfigGate>
      <Suspense fallback={<HeadingSkeleton />}>
        <AmcConfigurationPage />
      </Suspense>
    </AmcConfigGate>
  );
}

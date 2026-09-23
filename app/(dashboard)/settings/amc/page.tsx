import type { Metadata } from "next";
import { Suspense } from "react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { AmcAccessGate } from "@/components/dashboard/extensions/amc/amc-access-gate";
import { AmcSettingsPage } from "@/components/dashboard/extensions/amc/amc-settings-page";

export const metadata: Metadata = {
  title: "AMC settings | Settings",
  robots: { index: false, follow: false },
};

/*
  AMC Settings sits with the rest of the admin configuration now. Admins
  only (FR6.1): it is the wording every proposal and contract is written
  from. The page keeps which block is open in ?view=, so it needs Suspense.
*/
export default function AmcSettingsRoute() {
  return (
    <AmcAccessGate adminOnly>
      <Suspense fallback={<HeadingSkeleton />}>
        <AmcSettingsPage />
      </Suspense>
    </AmcAccessGate>
  );
}

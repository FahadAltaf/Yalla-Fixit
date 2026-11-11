import { Suspense } from "react";
import type { Metadata } from "next";

import { CallOutsPage } from "@/components/dashboard/extensions/amc-contracts/call-outs-page";
import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Call outs | AMC",
  robots: { index: false, follow: false },
};

/* The page opens a call out from ?open=<id>, which needs a Suspense boundary. */
export default async function CallOutsRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_CALL_OUTS))) return <NoPageAccess page="Call outs" />;
  return (
    <Suspense fallback={<HeadingSkeleton withActions />}>
      <CallOutsPage />
    </Suspense>
  );
}

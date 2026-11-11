import type { Metadata } from "next";

import { RenewalsPage } from "@/components/dashboard/extensions/amc-contracts/renewals-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Renewals | AMC",
  robots: { index: false, follow: false },
};

export default async function RenewalsRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_RENEWALS))) return <NoPageAccess page="Renewals" />;
  return <RenewalsPage />;
}

import type { Metadata } from "next";

import { AmcOpsSettings } from "@/components/dashboard/extensions/amc-contracts/amc-ops-settings";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Operations settings | AMC",
  robots: { index: false, follow: false },
};

export default async function Route() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_OPERATIONS_SETTINGS))) return <NoPageAccess page="Operations settings" />;
  return <AmcOpsSettings />;
}

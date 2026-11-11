import type { Metadata } from "next";

import { FsmServiceMapping } from "@/components/dashboard/extensions/amc-contracts/fsm-service-mapping";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "FSM service mapping | AMC",
  robots: { index: false, follow: false },
};

export default async function FsmServiceMappingRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_FSM_MAPPING))) return <NoPageAccess page="FSM mapping" />;
  return <FsmServiceMapping />;
}

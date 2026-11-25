import type { Metadata } from "next";

import { VisitPage } from "@/components/dashboard/extensions/amc-contracts/visit-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAnyAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Visit | AMC",
  robots: { index: false, follow: false },
};

export default async function VisitRoute({ params }: { params: Promise<{ id: string }> }) {
  /*
    The same people as the Visits list and a contract's Schedule tab (23 Nov
    2026): an inspector (Site visits, Contracts) saw their own contract's
    visits listed and was refused on opening one. Which visit they may read
    is decided by its routes: AMC Visits sees every visit, anyone else their
    own contracts' visits and their own site visits; any other is "not found".
  */
  if (!(await canSeeAnyAmcPage([ResourceType.AMC_VISITS, ResourceType.AMC_SITE_VISITS, ResourceType.AMC_CONTRACTS]))) return <NoPageAccess page="Visits" />;
  const { id } = await params;
  return <VisitPage id={id} />;
}

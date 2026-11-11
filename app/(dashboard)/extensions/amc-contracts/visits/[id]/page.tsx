import type { Metadata } from "next";

import { VisitPage } from "@/components/dashboard/extensions/amc-contracts/visit-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Visit | AMC",
  robots: { index: false, follow: false },
};

export default async function VisitRoute({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canSeeAmcPage(ResourceType.AMC_VISITS))) return <NoPageAccess page="Visits" />;
  const { id } = await params;
  return <VisitPage id={id} />;
}

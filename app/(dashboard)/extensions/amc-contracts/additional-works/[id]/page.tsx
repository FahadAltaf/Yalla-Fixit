import type { Metadata } from "next";

import { AdditionalWorkPage } from "@/components/dashboard/extensions/amc-contracts/additional-work-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Additional work | AMC",
  robots: { index: false, follow: false },
};

export default async function AdditionalWorkRoute({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canSeeAmcPage(ResourceType.AMC_ADDITIONAL_WORKS))) return <NoPageAccess page="Additional work" />;
  const { id } = await params;
  return <AdditionalWorkPage id={id} />;
}

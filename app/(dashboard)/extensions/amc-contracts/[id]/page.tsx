import type { Metadata } from "next";

import { ContractDetail } from "@/components/dashboard/extensions/amc-contracts/contract-detail";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "AMC contract | Extensions",
  robots: { index: false, follow: false },
};

export default async function AmcContractRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_CONTRACTS))) return <NoPageAccess page="Contracts" />;
  const { id } = await params;
  return <ContractDetail id={id} />;
}

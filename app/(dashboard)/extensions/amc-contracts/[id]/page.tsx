import type { Metadata } from "next";

import { ContractDetail } from "@/components/dashboard/extensions/amc-contracts/contract-detail";

export const metadata: Metadata = {
  title: "AMC contract | Extensions",
  robots: { index: false, follow: false },
};

export default async function AmcContractRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContractDetail id={id} />;
}

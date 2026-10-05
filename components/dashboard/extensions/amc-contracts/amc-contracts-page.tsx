"use client";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { PageHeading } from "@/components/dashboard/shared/kaizen";

import { ContractsList } from "./contracts-list";

/**
 * /extensions/amc-contracts -- signed AMC agreements in operation, and
 * signed proposals waiting to be activated. AMC proposals stays the sales
 * and document workflow; this is what happens after the signature.
 */
export function AmcContractsPage() {
  useBreadcrumbLabel("amc-contracts", "AMC contracts");
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Extensions"
        title="AMC contracts"
        description="Activate signed AMC proposals, track what each contract covers and how much is used, and see what is expiring."
      />
      <ContractsList />
    </div>
  );
}

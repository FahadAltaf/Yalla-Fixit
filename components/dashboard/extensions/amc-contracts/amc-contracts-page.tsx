"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Workflow } from "lucide-react";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/dashboard/shared/kaizen";

import { ContractsList } from "./contracts-list";
import { ContractsSummary } from "./contracts-summary";
import { CoverageCheckDialog } from "./coverage-check-dialog";

/**
 * /extensions/amc-contracts -- signed AMC agreements in operation, and
 * signed proposals waiting to be activated. AMC proposals stays the sales
 * and document workflow; this is what happens after the signature.
 */
export function AmcContractsPage() {
  useBreadcrumbLabel("amc-contracts", "AMC contracts");
  const [checking, setChecking] = useState(false);
  const [summaryKey, setSummaryKey] = useState(0);
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Extensions"
        title="AMC contracts"
        description="Activate signed AMC proposals, track what each contract covers and how much is used, and see what is expiring."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/extensions/amc-contracts/fsm-services">
                <Workflow className="size-4" />
                FSM service mapping
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setChecking(true)}>
              <ShieldCheck className="size-4" />
              Check coverage
            </Button>
          </div>
        }
      />
      <ContractsSummary refreshKey={summaryKey} />
      <ContractsList onRefresh={() => setSummaryKey((k) => k + 1)} />
      <CoverageCheckDialog open={checking} onOpenChange={setChecking} />
    </div>
  );
}

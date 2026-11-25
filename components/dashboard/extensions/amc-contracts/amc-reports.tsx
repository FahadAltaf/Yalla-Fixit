"use client";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { ModuleGuide } from "@/components/dashboard/extensions/amc-contracts/module-guide";

import { AmcReportsOverview } from "./amc-insights";

/**
 * AMC reports on one page (25 Nov 2026, the user: "no tabs, one view with
 * proper stats and charts"). What it holds is what BRD 5.15 and Jira ask for
 * (DEV-411 operational, DEV-412 commercial, DEV-414 dashboard, DEV-502 lost,
 * new against renewed, coordinators); see AmcReportsOverview. The expiry,
 * renewal pipeline and services lists that were tabs here are on the
 * Contracts and Renewals pages.
 */
export function AmcReports() {
  useBreadcrumbLabel("reports", "Reports");
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Insights"
        title="Reports"
        info={<ModuleGuide module="reports" />}
        description="Today's figures, then operations and commercial for the period you pick. From contract data only; draft or rejected proposals and quotes are never counted as revenue."
      />
      <AmcReportsOverview />
    </div>
  );
}

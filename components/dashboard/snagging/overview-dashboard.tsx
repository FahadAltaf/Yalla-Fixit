"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";

import { InspectionActivity } from "./overview/inspection-activity";
import { InspectionPipeline } from "./overview/inspection-pipeline";
import { InspectorPerformance } from "./overview/inspector-performance";
import { KpiRow } from "./overview/kpi-row";
import { NeedsAttention } from "./overview/needs-attention";
import { QuotationAnalytics } from "./overview/quotation-analytics";
import { SnagOverview } from "./overview/snag-overview";
import { SnagSeverity } from "./overview/snag-severity";
import { SnagsByCategory } from "./overview/snags-by-category";
import { UpcomingInspections } from "./overview/upcoming-inspections";
import { lastFetchedAt, refreshAll } from "./overview/use-section";
import { PageHeading } from "./shared";

/**
 * The Snagging Overview.
 *
 * Eight sections, each fetching its own data, rendering its own
 * skeleton, and failing on its own. There is deliberately no combined
 * request and no page-level spinner: the KPI row is interactive while
 * the category chart is still loading, and a broken quotation query
 * costs one card rather than the page.
 *
 * The order is an argument about attention. What needs somebody now
 * comes first — headline figures, then activity beside the attention
 * list, then the pipeline beside what is booked. The two analytics
 * sections sit past a divider at the bottom, quieter, and do not even
 * fetch until they are scrolled to.
 */
export default function SnaggingOverviewDashboard() {
  const router = useRouter();
  const { userProfile } = useAuth();
  const canCreate = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE);

  const [refreshing, setRefreshing] = useState(false);

  const pull = useCallback(() => {
    setRefreshing(true);
    refreshAll();
    // The sections each reload on their own; this is only how long the
    // button says it is working, so the click has an answer.
    window.setTimeout(() => setRefreshing(false), 600);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Property care"
        title="Snagging Overview"
        description="Monitor inspections, quotations, snags, and work requiring attention."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LastUpdated refreshing={refreshing} />
            <Button variant="outline" onClick={pull} disabled={refreshing}>
              <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
              Pull changes
            </Button>
            {canCreate ? (
              <Button onClick={() => router.push("/snagging/jobs/new")}>
                <Plus className="size-4" />
                New job
              </Button>
            ) : null}
          </div>
        }
      />

      <KpiRow />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="">
          <InspectionActivity />
        </div>
        <div className="">
          <InspectionPipeline />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">

        <div className="">
          <NeedsAttention />
        </div>
        <div className="">
          <UpcomingInspections />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SnagOverview />
        <SnagSeverity />
      </div>

      <SnagsByCategory />

      {/* Everything below here is analysis rather than action. The
          divider and the quieter cards are what stop it competing with
          the attention list above. */}
      <div
        className="mt-4 flex items-center gap-4"
        role="separator"
        aria-label="Analytics"
      >
        <Separator className="flex-1" />
        <span className="text-muted-foreground shrink-0 text-xs font-semibold tracking-[0.14em] uppercase">
          Analytics
        </span>
        <Separator className="flex-1" />
      </div>

      <InspectorPerformance />
      <QuotationAnalytics />
    </div>
  );
}

/**
 * How stale the page is, in the words somebody would use.
 *
 * Ticks on its own rather than on a render, so the figure keeps up
 * without any section having to re-render to move it.
 */
function LastUpdated({ refreshing }: { refreshing: boolean }) {
  // Read on a timer rather than during render: the cache and the clock
  // are both mutable state outside React, and reading them while
  // rendering makes the output depend on when the render happened.
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const describe = () => {
      const at = lastFetchedAt();
      if (at === null) {
        setLabel(null);
        return;
      }
      const minutes = Math.floor((Date.now() - at) / 60_000);
      setLabel(minutes < 1 ? "just now" : minutes === 1 ? "1m ago" : `${minutes}m ago`);
    };

    describe();
    const timer = window.setInterval(describe, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshing]);

  if (refreshing) return <span className="text-muted-foreground text-sm">Updating…</span>;
  if (!label) return null;
  return <span className="text-muted-foreground text-sm">Last updated {label}</span>;
}

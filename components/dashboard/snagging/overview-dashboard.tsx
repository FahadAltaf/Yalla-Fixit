"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { InspectionActivity } from "./overview/inspection-activity";
import { InspectionPipeline } from "./overview/inspection-pipeline";
import { InspectorPerformance } from "./overview/inspector-performance";
import { KpiRow } from "./overview/kpi-row";
import { NeedsAttention } from "./overview/needs-attention";
import { QuotationAnalytics } from "./overview/quotation-analytics";
import { OverviewRange, RANGES, rangeLabel } from "./overview/range";
import { UpcomingInspections } from "./overview/upcoming-inspections";
import { lastFetchedAt, refreshAll } from "./overview/use-section";
import { PageHeading } from "./shared";

/**
 * The Snagging Overview.
 *
 * Seven sections, each fetching its own data, rendering its own
 * skeleton, and failing on its own. There is deliberately no combined
 * request and no page-level spinner: the KPI row is interactive while
 * the activity chart is still loading, and a broken quotation query
 * costs one card rather than the page.
 *
 * Every figure on it counts only what the reader raised or was put on
 * (FR-10.01). Snag breakdowns and the org-wide view of the same work
 * live in Analytics.
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

  /*
    The window every measured card is read through.

    Held here rather than in each card, so the KPI row, the activity
    chart, the pipeline and the two analytics sections are always
    answering for the same stretch of time. It reaches them through the
    URL of their requests — see OverviewRange — which means each range
    is cached separately and flicking back to one already seen is
    instant.
  */
  const [days, setDays] = useState(30);

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
        /*
          Whose figures these are, said out loud (FR-10.01).

          The page counts only what the reader raised or was put on. An
          unqualified "Monitor inspections" over a page that is empty
          because you happen to have nothing on today reads as a broken
          dashboard rather than a clear desk — and it would quietly
          contradict Analytics, which shows the same work for everyone.
        */
        description="Your inspections, quotations and anything waiting on you. Analytics has the same work across everyone."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LastUpdated refreshing={refreshing} />
            <Select
              value={String(days)}
              onValueChange={(value) => setDays(Number(value))}
            >
              <SelectTrigger className="w-36" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {RANGES.map((range) => (
                  <SelectItem key={range.days} value={String(range.days)}>
                    Last {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <OverviewRange days={days}>
        <KpiRow />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="">
            <InspectionActivity />
          </div>
          <div className="">
            <InspectionPipeline />
          </div>
        </div>

        {/*
          These two are outside the range on purpose, and the line above
          them says so.

          "Needs attention" is what is wrong now and "Upcoming" is what
          is booked next. Neither measures a period, and hiding a late
          job because it was raised before the chosen window would be
          the dashboard quietly losing work.
        */}
        <p className="text-muted-foreground mt-2 text-xs">
          Figures above cover the last {rangeLabel(days)}. The two lists
          below are always current.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="">
            <NeedsAttention />
          </div>
          <div className="">
            <UpcomingInspections />
          </div>
        </div>

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
      </OverviewRange>
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

"use client";

import { InlineError } from "./section-shell";
import { StatCard, StatCardGrid, StatGridSkeleton } from "../shared";
import { useSection } from "./use-section";

type Kpis = {
  periodDays: number;
  total: { value: number; trend: number | null };
  assigned: { value: number; today: number };
  inProgress: { value: number; activeInspectors: number };
  waitingReview: { value: number };
  completed: { value: number; trend: number | null };
};

/**
 * The five headline figures (§2).
 *
 * Every card links to the list it counts, so a number is never a
 * dead end. There is no "Needs correction" card by design — that
 * belongs in Needs Attention, where it comes with the job it is about
 * and something to do.
 */
export function KpiRow() {
  const { data, loading, error, reload } = useSection<Kpis>(
    "/api/snagging/overview/kpis",
    {
      staleMs: 60_000,
    },
  );

  if (error) {
    return <InlineError message={error} onRetry={reload} />;
  }
  if (loading || !data) {
    return <StatGridSkeleton count={5} />;
  }

  const period = `vs previous ${data.periodDays} days`;

  return (
    <StatCardGrid columns={5}>
      <StatCard
        label="Total jobs"
        value={data.total.value}
        headline={trendLabel(data.total.trend, period)}
        caption={`Raised in the last ${data.periodDays} days`}
        tone={toneFor(data.total.trend)}
        trend={trendBadge(data.total.trend)}
        href="/snagging/jobs"
      />
      <StatCard
        label="Assigned"
        value={data.assigned.value}
        headline={
          data.assigned.today === 0
            ? "None assigned today"
            : `${data.assigned.today} assigned today`
        }
        caption="Waiting for the inspector to start"
        href="/snagging/jobs?status=assigned"
      />
      <StatCard
        label="In progress"
        value={data.inProgress.value}
        headline={
          data.inProgress.activeInspectors === 1
            ? "1 inspector active"
            : `${data.inProgress.activeInspectors} inspectors active`
        }
        caption="Being walked right now"
        href="/snagging/jobs?status=in_progress"
      />
      <StatCard
        label="Waiting review"
        value={data.waitingReview.value}
        headline={
          data.waitingReview.value > 0 ? "Needs action" : "Nothing waiting"
        }
        caption="Submitted and not yet approved"
        tone={data.waitingReview.value > 0 ? "progress" : "neutral"}
        href="/snagging/review"
      />
      <StatCard
        label="Completed"
        value={data.completed.value}
        headline={trendLabel(data.completed.trend, period)}
        caption={`Approved in the last ${data.periodDays} days`}
        tone={toneFor(data.completed.trend)}
        trend={trendBadge(data.completed.trend)}
        href="/snagging/jobs?status=approved"
      />
    </StatCardGrid>
  );
}

/**
 * The movement in words as well as in the badge.
 *
 * The badge alone carries direction in colour and an arrow; the footer
 * line repeats it as a sentence so the card does not depend on either.
 */
function trendLabel(trend: number | null, period: string): string {
  if (trend === null) return "No comparable period";
  if (trend === 0) return `Level ${period}`;
  return `${trend > 0 ? "Up" : "Down"} ${Math.abs(trend)}% ${period}`;
}

function trendBadge(trend: number | null) {
  if (trend === null || trend === 0) return undefined;
  return {
    value: `${trend > 0 ? "+" : ""}${trend}%`,
    direction: trend > 0 ? ("up" as const) : ("down" as const),
  };
}

/**
 * More jobs arriving is not good news the way more completions is, so
 * only completion movement is toned; intake stays neutral.
 */
function toneFor(trend: number | null): "neutral" | "good" | "bad" {
  if (trend === null || trend === 0) return "neutral";
  return trend > 0 ? "good" : "bad";
}

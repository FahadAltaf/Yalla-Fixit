"use client";

import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";

import { CHART_COLOR } from "@/lib/snagging/chart-palette";

import { ChartSkeleton, SectionShell } from "./section-shell";
import { useRangedSection } from "./range";

type Activity = {
  periodDays: number;
  points: Array<{
    day: string;
    label: string;
    created: number;
    completed: number;
  }>;
};

/*
  Intake is neutral because arriving work is not good or bad news;
  completions are green because that is the number anybody is trying to
  move. The legend swatches are generated from this same config, so a
  swatch cannot drift from the line it labels.
*/
const config = {
  created: { label: "Jobs created", color: CHART_COLOR.neutral },
  completed: { label: "Inspections completed", color: CHART_COLOR.good },
} satisfies ChartConfig;

/**
 * Intake against throughput over the window (§3).
 *
 * Two series is the limit on purpose: the question this answers is
 * whether work is going out as fast as it comes in, and a third line
 * makes that harder to see rather than easier. Intake is the muted
 * line, completions carry the accent — completions are the number
 * anybody is actually trying to move.
 */
export function InspectionActivity() {
  const router = useRouter();
  /*
    No period select of its own any more.

    It used to carry 7/30 days while the KPI row beside it was fixed at
    30 and the pipeline counted everything ever raised. One control at
    the top of the page now sets all of them, so the cards can be read
    against each other.
  */
  const { data, loading, error, reload } = useRangedSection<Activity>(
    "/api/snagging/overview/activity",
    { staleMs: 300_000 },
  );

  const total = (data?.points ?? []).reduce(
    (sum, point) => sum + point.created + point.completed,
    0,
  );

  return (
    <SectionShell
      title="Inspection activity"
      description="Jobs raised against inspections signed off. Click a day to open the jobs raised on it."
      icon={<Activity />}
      centerBody
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!loading && total === 0}
      empty={
        <EmptyState
          icon={<Activity />}
          title="No activity in this period"
          description="No jobs were raised and none were signed off in the last few weeks. Widen the period to look further back."
          className="py-10"
        />
      }
      skeleton={<ChartSkeleton bars={14} />}
    >
      <ChartContainer config={config} className="h-56 w-full">
        <LineChart
          data={data?.points ?? []}
          margin={{ left: -20, right: 8, top: 8 }}
          className="cursor-pointer"
          /*
            A day opens the jobs raised on it (FR-10.01).

            Intake rather than completions, because a point carries both
            series and a click cannot say which one was meant — and of the
            two, "what came in that day" is the list somebody actually
            goes looking for.
          */
          onClick={(state) => {
            const day = (
              state as { activePayload?: Array<{ payload?: { day?: string } }> }
            )?.activePayload?.[0]?.payload?.day;
            if (day) router.push(`/snagging/jobs?createdFrom=${day}&createdTo=${day}`);
          }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={36}
          />
          <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="created"
            type="monotone"
            stroke="var(--color-created)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            dataKey="completed"
            type="monotone"
            stroke="var(--color-completed)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    </SectionShell>
  );
}

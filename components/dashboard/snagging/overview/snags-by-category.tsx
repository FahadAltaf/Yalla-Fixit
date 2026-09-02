"use client";

import { Layers } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";

import { CHART_COLOR } from "@/lib/snagging/chart-palette";

import { ChartSkeleton, SectionShell } from "./section-shell";
import { useSection } from "./use-section";

type Categories = {
  total: number;
  categories: Array<{ category: string; count: number; mapped: boolean }>;
};

const config = { count: { label: "Snags" } } satisfies ChartConfig;

/**
 * Snags per trade category (§6), biggest first.
 *
 * Sorted descending on purpose: the point of this chart is the first
 * bar. If plumbing is the recurring problem across the portfolio, that
 * should be readable in a second, not worked out by comparing six bars
 * in catalogue order.
 */
export function SnagsByCategory() {
  const { data, loading, error, reload } = useSection<Categories>(
    "/api/snagging/overview/categories",
    { staleMs: 600_000 },
  );

  const unmapped = (data?.categories ?? [])
    .filter((row) => !row.mapped)
    .map((row) => row.category);

  return (
    <SectionShell
      title="Snags by category"
      description="Where defects cluster across the portfolio, worst first."
      icon={<Layers />}
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!loading && (data?.total ?? 0) === 0}
      empty={
        <EmptyState
          icon={<Layers />}
          title="No snags to categorise"
          description="Defects appear here once inspectors start capturing them."
          className="py-10"
        />
      }
      skeleton={<ChartSkeleton bars={6} />}
    >
      <ChartContainer config={config} className="h-64 w-full">
        <BarChart
          data={data?.categories ?? []}
          layout="vertical"
          margin={{ left: 8, right: 16 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="category"
            tickLine={false}
            axisLine={false}
            width={80}
            tickMargin={4}
          />
          <ChartTooltip content={<ChartTooltipContent labelKey="category" />} />
          {/*
            One series, one token — the same brand red the rest of the
            page uses. The sort order is what says which category is the
            problem; six colours would only bury it.
          */}
          <Bar dataKey="count" radius={[0, 4, 4, 0]} fill={CHART_COLOR.brand} />
        </BarChart>
      </ChartContainer>

      {unmapped.length > 0 ? (
        <p className="text-muted-foreground mt-3 text-xs">
          {unmapped.join(" and ")} {unmapped.length === 1 ? "has" : "have"} no
          defects in the current catalogue yet, so{" "}
          {unmapped.length === 1 ? "it reads" : "they read"} as zero rather than
          being hidden.
        </p>
      ) : null}
    </SectionShell>
  );
}

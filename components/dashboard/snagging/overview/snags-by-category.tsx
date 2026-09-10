"use client";

import { useState } from "react";
import { ArrowRight, Layers } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";

import { CHART_COLOR } from "@/lib/snagging/chart-palette";

import { ChartSkeleton, SectionShell } from "./section-shell";
import { useSection } from "./use-section";

type Category = {
  code: string;
  category: string;
  count: number;
  mapped: boolean;
};

type Categories = {
  total: number;
  categories: Category[];
};

const config = { count: { label: "Snags" } } satisfies ChartConfig;

/**
 * The card shows this many; the rest are a click away.
 *
 * The catalogue carries twenty categories, and drawing all twenty in a
 * dashboard card gives each bar about a centimetre and the labels no room
 * at all. Ten is enough to see where the portfolio's defects actually sit,
 * which is the question this chart exists to answer.
 */
const TOP_N = 10;

/**
 * Snags per category (§6), biggest first.
 *
 * Sorted descending on purpose: the point of this chart is the first bar.
 * If doors and windows are the recurring problem across the portfolio,
 * that should be readable in a second, not worked out by comparing twenty
 * bars in catalogue order.
 */
export function SnagsByCategory() {
  const { data, loading, error, reload } = useSection<Categories>(
    "/api/snagging/overview/categories",
    { staleMs: 600_000 },
  );
  const [allOpen, setAllOpen] = useState(false);

  const categories = data?.categories ?? [];
  const top = categories.slice(0, TOP_N);

  return (
    <>
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
        skeleton={<ChartSkeleton bars={TOP_N} />}
        footer={
          categories.length > top.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-brand h-auto w-full justify-between px-0 hover:bg-transparent"
              onClick={() => setAllOpen(true)}
            >
              View all {categories.length}
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          ) : null
        }
      >
        <CategoryChart rows={top} />
      </SectionShell>

      <AllCategoriesDialog
        open={allOpen}
        onOpenChange={setAllOpen}
        rows={categories}
        total={data?.total ?? 0}
      />
    </>
  );
}

/**
 * The bars, at whatever length the list happens to be.
 *
 * Height is per row rather than fixed: ten bars in a card and twenty in a
 * dialog want the same bar thickness, not the same overall height squeezed
 * to fit. The card and the dialog share this so the two cannot drift.
 */
function CategoryChart({
  rows,
  /*
    The gutter and the truncation are one decision, not two.

    Recharts word-wraps any tick that will not fit its axis width, and a
    label on two lines inside a 26px row runs into its neighbours -- which
    is what a long name in a narrow gutter actually looks like, not a
    clean cut. At this font a character is roughly 5.2px, so the width has
    to stay comfortably past `maxLabel * 5.2` for the label to hold one
    line.

    The dialog has room for a wider gutter and passes both up, which is
    why these are arguments rather than constants.
  */
  axisWidth = 185,
  maxLabel = 26,
}: {
  rows: Category[];
  axisWidth?: number;
  maxLabel?: number;
}) {
  return (
    <ChartContainer
      config={config}
      className="w-full"
      style={{ height: Math.max(180, rows.length * 26 + 40) }}
    >
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="category"
          tickLine={false}
          axisLine={false}
          width={axisWidth}
          tickMargin={4}
          // Every category gets a label. Left to itself recharts thins the
          // ticks out to avoid collisions, which on a bar chart silently
          // leaves half the bars unlabelled.
          interval={0}
          /*
            The tick is drawn here rather than left to recharts.

            Recharts wraps a tick onto a second line by its own heuristic,
            not by whether the label actually fits -- names only 102px wide
            were breaking inside a 185px gutter while a 148px one stayed on
            one line. Two lines in a 26px row collide with the neighbouring
            category, which is the thing that has to not happen. A plain
            <text> runs none of that logic, so a label is one line or it is
            cut, and the tooltip still carries the full name.
          */
          tick={(props) => <CategoryTick {...props} maxLabel={maxLabel} />}
        />
        <ChartTooltip content={<ChartTooltipContent labelKey="category" />} />
        {/*
          One series, one token — the same brand red the rest of the page
          uses. The sort order is what says which category is the problem;
          twenty colours would only bury it.
        */}
        <Bar dataKey="count" radius={[0, 4, 4, 0]} fill={CHART_COLOR.brand} />
      </BarChart>
    </ChartContainer>
  );
}

/** One category name, on exactly one line. */
function CategoryTick({
  x = 0,
  y = 0,
  payload,
  maxLabel,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  maxLabel: number;
}) {
  const full = payload?.value ?? "";
  const label = full.length > maxLabel ? `${full.slice(0, maxLabel)}…` : full;

  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={12}
      className="fill-muted-foreground"
    >
      {label}
    </text>
  );
}

/**
 * All twenty, in one scrollable chart.
 *
 * Same bars as the card rather than a different rendering of the same
 * numbers, so opening it feels like seeing more of the chart instead of
 * arriving somewhere else.
 */
function AllCategoriesDialog({
  open,
  onOpenChange,
  rows,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Category[];
  total: number;
}) {
  const empty = rows.filter((row) => row.count === 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">Snags by category</DialogTitle>
          <DialogDescription>
            Every category in the catalogue, worst first.
          </DialogDescription>
        </DialogHeader>

        <div className="border-y px-6 py-3">
          <p className="text-muted-foreground text-sm">
            {total === 1 ? "1 snag" : `${total} snags`} across {rows.length}{" "}
            categories
          </p>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {/* Room here for every name in full — nothing is cut. */}
          <CategoryChart rows={rows} axisWidth={240} maxLabel={44} />
        </div>

        {empty > 0 ? (
          <div className="text-muted-foreground border-t px-6 py-3 text-xs">
            {empty} {empty === 1 ? "category has" : "categories have"} nothing
            recorded yet and read as zero rather than being hidden.
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

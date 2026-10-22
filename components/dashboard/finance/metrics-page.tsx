"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Ban,
  Clock,
  Hourglass,
  PauseCircle,
  PieChart as PieChartIcon,
  RefreshCw,
  Scale,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts";

import { PageHeading, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import {
  ChartSkeleton,
  DonutSkeleton,
  InlineError,
  LinesSkeleton,
  SectionShell,
} from "@/components/dashboard/snagging/overview/section-shell";
import { RANGES, rangeLabel } from "@/components/dashboard/snagging/overview/range";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { addDaysToDateString } from "@/lib/scheduling/org-time";
import type { QueueStatus } from "@/lib/server/finance/queue";
import { CHART_COLOR } from "@/lib/snagging/chart-palette";
import { financeService, type FinanceMetricsResponse } from "@/modules/finance/finance-service";

import { QUEUE_STATUS_COLOR, QUEUE_STATUS_LABELS, aed } from "./shared";

/**
 * Invoicing metrics (BRD §5.1 Step 8, §6.9; DEV-441), laid out as the
 * Snagging overview is: headline cards, then the period's movement beside
 * how fast it is turned into invoices, then the queue as it stands, then
 * the quieter analysis past a divider. Every figure comes from the queue's
 * own timestamps and records, and most of them open the queue filtered to
 * what they count.
 *
 * One request feeds the page, so the sections share its loading and error
 * state; each still draws its own skeleton and empty state.
 */

const OPEN: QueueStatus[] = ["pending", "in_progress", "query_raised", "on_hold"];

/* Value that arrived is neutral; value invoiced is the number Finance moves. */
const activityConfig = {
  enteredValue: { label: "Entered the queue", color: CHART_COLOR.neutral },
  invoicedValue: { label: "Invoiced", color: CHART_COLOR.good },
} satisfies ChartConfig;

/* Waiting longer climbs from neutral to amber to red. */
const AGEING_COLOR: Record<string, string> = {
  "0-7": CHART_COLOR.neutralSoft,
  "8-14": CHART_COLOR.progress,
  "15-30": CHART_COLOR.attention,
  "31+": CHART_COLOR.attention,
};
const ageingConfig = { value: { label: "Waiting value" } } satisfies ChartConfig;

const statusConfig = Object.fromEntries(
  OPEN.map((status) => [status, { label: QUEUE_STATUS_LABELS[status], color: QUEUE_STATUS_COLOR[status] }]),
) satisfies ChartConfig;

const compactAed = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(Math.round(value));

export function FinanceMetricsPage() {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<FinanceMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* Only the latest range's answer is drawn. */
  const ticket = useRef(0);
  const load = useCallback(async (window: number) => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await financeService.metrics(window);
      if (mine === ticket.current) setData(result);
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : "Could not load the metrics");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(days);
  }, [load, days]);

  const reload = () => void load(days);
  /* The first load shows skeletons; a range change keeps the figures until the new ones land. */
  const waiting = loading && !data;
  const sectionError = data ? null : error;
  const range = rangeLabel(days);

  const summary = data?.summary;
  const metrics = data?.metrics;
  const period = data?.period;

  const openCount = summary ? summary.pending.count + summary.inProgress.count + summary.queryRaised.count + summary.onHold.count : 0;
  const statusSlices = summary
    ? OPEN.map((status) => {
        const bucket = summary[status === "in_progress" ? "inProgress" : status === "query_raised" ? "queryRaised" : status === "on_hold" ? "onHold" : "pending"];
        return { status, label: QUEUE_STATUS_LABELS[status], count: bucket.count, value: bucket.value, fill: QUEUE_STATUS_COLOR[status] };
      })
    : [];
  const activityTotal = (period?.activity ?? []).reduce((sum, p) => sum + p.enteredCount + p.invoicedCount, 0);
  const ageingTotal = (metrics?.ageing ?? []).reduce((sum, band) => sum + band.count, 0);
  const slowest = Math.max(1, ...(period?.daysToInvoiceByUser ?? []).map((row) => row.averageDays));
  const widestReason = Math.max(1, ...(metrics?.excludedByReason ?? []).map((row) => row.value));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/finance/queue">
            <ArrowLeft className="size-4" />
            Ready to invoice
          </Link>
        </Button>
      </div>

      <PageHeading
        eyebrow="Finance"
        title="Invoicing metrics"
        description="How fast completed work is invoiced, what is waiting and for how long, holds, exclusions and variance."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
              <SelectTrigger className="w-36" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {RANGES.map((option) => (
                  <SelectItem key={option.days} value={String(option.days)}>
                    Last {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={reload} disabled={loading}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </Button>
          </div>
        }
      />

      {error && !data ? (
        <InlineError message={error} onRetry={reload} />
      ) : waiting || !summary || !metrics || !period ? (
        <StatGridSkeleton count={5} />
      ) : (
        <StatCardGrid columns={5}>
          <StatCard
            label="Awaiting invoice"
            value={aed(metrics.openValue)}
            headline={openCount === 1 ? "1 item waiting" : `${openCount} items waiting`}
            caption="Pending, in progress, query or hold"
            href="/finance/queue"
          />
          <StatCard
            label="Aged"
            value={period.aged.count}
            headline={period.aged.count > 0 ? `${aed(period.aged.value)} waiting too long` : "Nothing aged"}
            caption={`Pending for ${period.aged.afterDays} days or more`}
            tone={period.aged.count > 0 ? "bad" : "good"}
            href="/finance/queue?status=pending&aged=1"
          />
          <StatCard
            label="Invoiced"
            value={aed(period.invoiced.value)}
            headline={trendLabel(period.invoiced.trend, `vs previous ${range}`)}
            caption={`${period.invoiced.count} ${period.invoiced.count === 1 ? "invoice" : "invoices"} in the last ${range}`}
            tone={toneFor(period.invoiced.trend)}
            trend={trendBadge(period.invoiced.trend)}
            href="/finance/queue?status=invoiced"
          />
          <StatCard
            label="Days to invoice"
            value={period.averageDaysToInvoice === null ? "—" : period.averageDaysToInvoice}
            headline={period.averageDaysToInvoice === null ? "No invoice in this period" : "Average, entered to invoiced"}
            caption={`Over invoices recorded in the last ${range}`}
          />
          <StatCard
            label="Excluded value"
            value={aed(summary.excluded.value)}
            headline={summary.excluded.count === 1 ? "1 item verified" : `${summary.excluded.count} items verified`}
            caption="Marked not invoiceable and verified"
            href="/finance/queue?status=excluded"
          />
        </StatCardGrid>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionShell
          title="Queue activity"
          description="Value entering the queue against value invoiced. Click a day to open what entered on it."
          icon={<Activity />}
          centerBody
          loading={waiting}
          error={sectionError}
          onRetry={reload}
          isEmpty={!waiting && activityTotal === 0}
          empty={
            <EmptyState
              icon={<Activity />}
              title="No movement in this period"
              description={`Nothing entered the queue and nothing was invoiced in the last ${range}. Widen the period to look further back.`}
              className="py-10"
            />
          }
          skeleton={<ChartSkeleton bars={14} />}
        >
          <ChartContainer config={activityConfig} className="h-56 w-full">
            <AreaChart
              data={period?.activity ?? []}
              margin={{ left: -12, right: 8, top: 8 }}
              className="cursor-pointer"
              onClick={(state) => {
                const day = (state as { activePayload?: Array<{ payload?: { day?: string } }> })?.activePayload?.[0]?.payload?.day;
                if (!day || !period) return;
                // A weekly point opens its whole week.
                const to = period.bucket === "week" ? addDaysToDateString(day, 6) : day;
                router.push(`/finance/queue?status=all&from=${day}&to=${to < period.to ? to : period.to}`);
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compactAed} />
              <ChartTooltip content={<ChartTooltipContent labelKey="label" formatter={tooltipAed} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                dataKey="enteredValue"
                type="monotone"
                stroke="var(--color-enteredValue)"
                fill="var(--color-enteredValue)"
                fillOpacity={0.12}
                strokeWidth={2}
              />
              <Area
                dataKey="invoicedValue"
                type="monotone"
                stroke="var(--color-invoicedValue)"
                fill="var(--color-invoicedValue)"
                fillOpacity={0.18}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </SectionShell>

        <SectionShell
          title="Days to invoice, by Finance user"
          description={`From entering the queue to the MAHER invoice, over the last ${range}.`}
          icon={<Clock />}
          centerBody
          loading={waiting}
          error={sectionError}
          onRetry={reload}
          isEmpty={!waiting && (period?.daysToInvoiceByUser.length ?? 0) === 0}
          empty={
            <EmptyState
              icon={<Clock />}
              title="No invoice recorded in this period"
              description="The figure fills in once Finance records MAHER invoices against queue items."
              className="py-10"
            />
          }
          skeleton={<LinesSkeleton rows={4} />}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <ul className="min-w-0 space-y-3">
              {(period?.daysToInvoiceByUser ?? []).map((row) => (
                <li key={row.user} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm" title={row.user}>
                    {row.user}
                  </span>
                  <Progress
                    value={(row.averageDays / slowest) * 100}
                    className="h-2 flex-1"
                    indicatorStyle={{ background: CHART_COLOR.brand }}
                  />
                  <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                    <span className="font-medium">{row.averageDays}</span>
                    <span className="text-muted-foreground"> d · {row.invoices}</span>
                  </span>
                </li>
              ))}
            </ul>
            <FigureTile
              label="Average"
              value={period?.averageDaysToInvoice === null || period?.averageDaysToInvoice === undefined ? "—" : `${period.averageDaysToInvoice} d`}
              note={period ? `Over ${period.invoiced.count} ${period.invoiced.count === 1 ? "invoice" : "invoices"}` : ""}
            />
          </div>
        </SectionShell>
      </div>

      {/*
        The two charts below and the hold list are the queue as it stands,
        so the range does not apply to them; the line says so.
      */}
      <p className="text-muted-foreground mt-2 text-xs">
        Activity and days to invoice cover the last {range}. Everything below is the queue as it is now.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionShell
          title="Where the waiting value sits"
          description="Value awaiting invoice by status. Click a status to open it."
          icon={<PieChartIcon />}
          centerBody
          loading={waiting}
          error={sectionError}
          onRetry={reload}
          isEmpty={!waiting && openCount === 0}
          empty={
            <EmptyState
              icon={<PieChartIcon />}
              title="Nothing is waiting"
              description="Every item in the queue is invoiced or excluded."
              className="py-10"
            />
          }
          skeleton={<DonutSkeleton />}
        >
          <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ChartContainer config={statusConfig} className="mx-auto aspect-square h-56">
              <PieChart>
                <ChartTooltip
                  content={<ChartTooltipContent nameKey="status" hideLabel formatter={tooltipAed} />}
                />
                <Pie
                  data={statusSlices.filter((slice) => slice.value > 0)}
                  dataKey="value"
                  nameKey="status"
                  innerRadius={62}
                  strokeWidth={4}
                  className="cursor-pointer"
                  onClick={(slice: { status?: string }) => slice.status && router.push(`/finance/queue?status=${slice.status}`)}
                >
                  {statusSlices
                    .filter((slice) => slice.value > 0)
                    .map((slice) => (
                      <Cell key={slice.status} fill={slice.fill} />
                    ))}
                  <Label
                    content={({ viewBox }) =>
                      viewBox && "cx" in viewBox && "cy" in viewBox ? (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 6} className="fill-foreground text-lg font-semibold">
                            {compactAed(metrics?.openValue ?? 0)}
                          </tspan>
                          <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 14} className="fill-muted-foreground text-xs">
                            AED waiting
                          </tspan>
                        </text>
                      ) : null
                    }
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul className="space-y-1">
              {statusSlices.map((slice) => (
                <li key={slice.status}>
                  <Link
                    href={`/finance/queue?status=${slice.status}`}
                    className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors"
                  >
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: slice.fill }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{slice.label}</span>
                    <span className="text-right text-sm tabular-nums">
                      <span className="font-medium">{aed(slice.value)}</span>
                      <span className="text-muted-foreground block text-xs">
                        {slice.count} {slice.count === 1 ? "item" : "items"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </SectionShell>

        <SectionShell
          title="Ageing of waiting items"
          description="Value waiting, by days since it entered the queue."
          icon={<Hourglass />}
          centerBody
          loading={waiting}
          error={sectionError}
          onRetry={reload}
          isEmpty={!waiting && ageingTotal === 0}
          empty={
            <EmptyState
              icon={<Hourglass />}
              title="Nothing is waiting"
              description="Ageing fills in while items wait to be invoiced."
              className="py-10"
            />
          }
          skeleton={<ChartSkeleton bars={4} />}
        >
          <ChartContainer config={ageingConfig} className="h-56 w-full">
            <BarChart data={metrics?.ageing ?? []} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compactAed} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelKey="label"
                    formatter={(value, _name, item) => (
                      <span className="tabular-nums">
                        {aed(Number(value))} · {(item?.payload as { count?: number })?.count ?? 0} item(s)
                      </span>
                    )}
                  />
                }
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {(metrics?.ageing ?? []).map((band) => (
                  <Cell key={band.key} fill={AGEING_COLOR[band.key] ?? CHART_COLOR.neutral} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </SectionShell>
      </div>

      <SectionShell
        title="On hold"
        description="Items parked with a reason, longest waiting first."
        icon={<PauseCircle />}
        loading={waiting}
        error={sectionError}
        onRetry={reload}
        isEmpty={!waiting && (metrics?.onHold.length ?? 0) === 0}
        empty={
          /* A one-line answer: a full empty-state panel across the page said very little at great length. */
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <PauseCircle className="size-4 shrink-0" aria-hidden />
            Nothing is on hold. An item put on hold shows here with its reason until it is resumed.
          </p>
        }
        skeleton={<LinesSkeleton rows={3} />}
        bodyClassName="border-t px-0 pb-0"
      >
        <ul className="divide-y">
          {[...(metrics?.onHold ?? [])]
            .sort((a, b) => b.days - a.days)
            .map((row) => (
              <li key={row.id}>
                <Link href={`/finance/queue/${row.id}`} className="hover:bg-muted/50 flex items-start gap-3 px-5 py-3 transition-colors">
                  <PauseCircle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.reason || "No reason recorded"}</span>
                    <span className="text-muted-foreground block truncate text-sm">
                      {aed(row.value)} · {row.days} {row.days === 1 ? "day" : "days"} in the queue
                    </span>
                  </span>
                  <span className="text-brand mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm font-medium">
                    View
                    <ArrowRight className="size-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      </SectionShell>

      {/* Below here is analysis rather than action, as on the Snagging overview. */}
      <div className="mt-4 flex items-center gap-4" role="separator" aria-label="Analytics">
        <Separator className="flex-1" />
        <span className="text-muted-foreground shrink-0 text-xs font-semibold tracking-[0.14em] uppercase">Analytics</span>
        <Separator className="flex-1" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionShell
          title="Excluded value by reason"
          description="Verified exclusions, largest value first."
          icon={<Ban />}
          muted
          loading={waiting}
          error={sectionError}
          onRetry={reload}
          isEmpty={!waiting && (metrics?.excludedByReason.length ?? 0) === 0}
          empty={
            <EmptyState
              icon={<Ban />}
              title="No verified exclusions"
              description="Work marked not invoiceable shows here once it is verified."
              className="py-10"
            />
          }
          skeleton={<LinesSkeleton rows={4} />}
        >
          <ul className="space-y-3">
            {(metrics?.excludedByReason ?? []).map((row) => (
              <li key={row.reason}>
                {/* The reason above its bar: reasons are sentences, and a fixed label column cut them off. */}
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate" title={row.reason}>
                    {row.reason}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-medium">{aed(row.value)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {row.count} {row.count === 1 ? "item" : "items"}
                    </span>
                  </span>
                </div>
                <Progress
                  value={(row.value / widestReason) * 100}
                  className="mt-1.5 h-2"
                  indicatorStyle={{ background: CHART_COLOR.neutral }}
                />
              </li>
            ))}
          </ul>
        </SectionShell>

        <SectionShell
          title="Invoice variance"
          description={`MAHER amount against queue value, for invoices in the last ${range}.`}
          icon={<Scale />}
          muted
          loading={waiting}
          error={sectionError}
          onRetry={reload}
          isEmpty={!waiting && (period?.variance.invoices ?? 0) === 0}
          empty={
            <EmptyState
              icon={<Scale />}
              title="No invoice in this period"
              description="Variance is worked out from each invoice recorded against the queue."
              className="py-10"
            />
          }
          skeleton={<LinesSkeleton rows={3} />}
        >
          {period ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <FigureTile
                label="Differ"
                value={`${period.variance.withVariance} of ${period.variance.invoices}`}
                note="Invoices not at queue value"
              />
              <FigureTile label="Net" value={aed(period.variance.total)} note="Below queue value is negative" />
              <FigureTile label="Either way" value={aed(period.variance.absoluteTotal)} note="Sum of the differences" />
            </div>
          ) : null}
        </SectionShell>
      </div>
    </div>
  );
}

/** The muted figure tile the Snagging overview uses for its approval rate. */
function FigureTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-muted/50 flex flex-col justify-center rounded-lg border px-5 py-4 lg:min-w-44">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{note}</p>
    </div>
  );
}

function tooltipAed(value: unknown, name: unknown) {
  const label =
    (activityConfig as Record<string, { label: string }>)[String(name)]?.label ??
    (statusConfig as Record<string, { label: string }>)[String(name)]?.label ??
    String(name);
  return (
    <span className="flex w-full items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{aed(Number(value))}</span>
    </span>
  );
}

/* The Snagging KPI row's wording for movement, so both read alike. */
function trendLabel(trend: number | null, period: string): string {
  if (trend === null) return "No comparable period";
  if (trend === 0) return `Level ${period}`;
  return `${trend > 0 ? "Up" : "Down"} ${Math.abs(trend)}% ${period}`;
}

function trendBadge(trend: number | null) {
  if (trend === null || trend === 0) return undefined;
  return { value: `${trend > 0 ? "+" : ""}${trend}%`, direction: trend > 0 ? ("up" as const) : ("down" as const) };
}

function toneFor(trend: number | null): "neutral" | "good" | "bad" {
  if (trend === null || trend === 0) return "neutral";
  return trend > 0 ? "good" : "bad";
}

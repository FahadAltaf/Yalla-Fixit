"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, CalendarRange, Table2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";

import { DateRangePicker } from "@/components/data-table/toolbars/date-range-picker";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHART_COLOR } from "@/lib/snagging/chart-palette";
import { cn } from "@/lib/utils";

/**
 * The AMC reports' charts (23 Nov 2026, the user: "proper graphs, tables,
 * everything clear"). Built on the app's shadcn chart and its colour
 * vocabulary (lib/snagging/chart-palette): data that carries no judgement
 * is brand or neutral; colour that means something is green (done), amber
 * (in flight) or red (late, missed) and nothing else. Thin bars, rounded
 * data ends, one axis, a legend whenever there is more than one series,
 * and the table a click away on every chart.
 */

export const SERIES = CHART_COLOR;

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

const compactAed = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("en-AE", { maximumFractionDigits: 1 })}M` : Math.abs(n) >= 1_000 ? `${(n / 1_000).toLocaleString("en-AE", { maximumFractionDigits: 1 })}k` : n.toLocaleString("en-AE");
const plain = (n: number) => n.toLocaleString("en-AE", { maximumFractionDigits: 1 });

/** Bars for one or more series: columns over a category (months), or rows (names). */
export function ReportBars<R extends Record<string, unknown>>({
  data,
  categoryKey,
  series,
  layout = "columns",
  stacked = false,
  money = false,
  percent = false,
  height,
  categoryLabel = (v) => v,
  referenceAt,
  barColor,
  className,
}: {
  data: R[];
  categoryKey: keyof R & string;
  series: ChartSeries[];
  layout?: "columns" | "rows";
  stacked?: boolean;
  money?: boolean;
  percent?: boolean;
  height?: number;
  categoryLabel?: (value: string) => string;
  /** A dashed line at this value (100% utilisation). */
  referenceAt?: number;
  /** One series: each bar its own colour (ageing climbs to red). */
  barColor?: (row: R) => string;
  className?: string;
}) {
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) as ChartConfig;
  const tick = money ? compactAed : percent ? (n: number) => `${plain(n)}%` : plain;
  const rows = layout === "rows";
  /*
    Rows: as tall as the bars need (25 Nov 2026), not a 160px floor that left
    one or two bars floating in an empty plot. Each row 36px (more for
    side-by-side series), plus room for the axis.
  */
  const h = height ?? (rows ? Math.max(92, data.length * (stacked || series.length === 1 ? 36 : 24 * series.length) + 40) : 260);
  const last = series.length - 1;
  /* One plain series: its value printed at the end of each bar, so the axis is a guide, not the only way to read it. */
  const valueLabels = rows && series.length === 1 && !stacked;
  /* All zero: say so, rather than draw empty axes. */
  if (!data.some((row) => series.some((s) => Number(row[s.key]) > 0))) {
    return <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">Nothing to chart yet: every figure is 0.</p>;
  }
  return (
    <ChartContainer config={config} className={cn("w-full", className)} style={{ height: h }}>
      <BarChart
        data={data}
        layout={rows ? "vertical" : "horizontal"}
        margin={{ left: 4, right: valueLabels ? (money ? 56 : 36) : 16, top: 8, bottom: 0 }}
        barGap={2}
        barCategoryGap={rows ? "28%" : "22%"}
      >
        <CartesianGrid vertical={rows} horizontal={!rows} strokeDasharray="3 3" />
        {/* Listed directly, never in a fragment: recharts finds its axes by type among the chart children. */}
        {rows ? (
          /* Up to the largest value, not a rounded-up 4 for a count of 1: the longest bar spans the plot. */
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={tick}
            allowDecimals={false}
            /* Wide enough for a reference line (100% utilisation) beyond the largest bar. */
            domain={[0, (dataMax: number) => Math.max(dataMax, referenceAt ?? 0)]}
          />
        ) : null}
        {rows ? (
          <YAxis
            type="category"
            dataKey={categoryKey}
            tickLine={false}
            axisLine={false}
            /* As wide as the longest name needs (about 7.5px a letter), between 56 and 190px, so names stay on one line. */
            width={Math.min(190, Math.max(56, Math.max(...data.map((row) => Math.min(24, categoryLabel(String(row[categoryKey])).length))) * 7.5 + 24))}
            interval={0}
            tickFormatter={(v: string) => {
              const label = categoryLabel(String(v));
              return label.length > 24 ? `${label.slice(0, 23)}…` : label;
            }}
          />
        ) : null}
        {rows ? null : <XAxis dataKey={categoryKey} tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v: string) => categoryLabel(String(v))} />}
        {rows ? null : (
          <YAxis
            tickLine={false}
            axisLine={false}
            width={money ? 52 : 36}
            tickFormatter={tick}
            allowDecimals={false}
            /* Up to the tallest column (or the reference line), not a rounded-up 4 for a count of 1. */
            domain={[0, (dataMax: number) => Math.max(dataMax, referenceAt ?? 0)]}
          />
        )}
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(v) => categoryLabel(String(v))}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[2px]" style={{ background: item.color }} />
                    {config[String(name)]?.label ?? String(name)}
                  </span>
                  <span className="font-medium tabular-nums">{money ? `AED ${Number(value).toLocaleString("en-AE", { maximumFractionDigits: 2 })}` : percent ? `${plain(Number(value))}%` : plain(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {referenceAt !== undefined && rows ? <ReferenceLine x={referenceAt} stroke="var(--muted-foreground)" strokeDasharray="4 4" /> : null}
        {referenceAt !== undefined && !rows ? <ReferenceLine y={referenceAt} stroke="var(--muted-foreground)" strokeDasharray="4 4" /> : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={s.color}
            stackId={stacked ? "a" : undefined}
            maxBarSize={rows ? 20 : 36}
            /* Rounded data ends only: the top of a stack, or every bar when not stacked. */
            radius={!stacked || i === last ? (rows ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
            stroke="var(--card)"
            strokeWidth={stacked ? 1 : 0}
          >
            {barColor && series.length === 1 ? data.map((row, j) => <Cell key={j} fill={barColor(row)} />) : null}
            {valueLabels ? (
              <LabelList
                dataKey={s.key}
                position="right"
                offset={8}
                className="fill-foreground text-xs font-medium tabular-nums"
                formatter={(v: unknown) => tick(Number(v))}
              />
            ) : null}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** A funnel as labelled bars, each with its share of the first step. */
export function FunnelBars({ steps }: { steps: Array<{ label: string; value: number; hint?: string; tone?: "good" | "bad" }> }) {
  const top = Math.max(1, steps[0]?.value ?? 0);
  return (
    <ol className="grid gap-2.5">
      {steps.map((s, i) => {
        const share = Math.round((s.value / top) * 100);
        return (
          <li key={s.label} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3 text-sm">
            <span className="text-muted-foreground truncate">{s.label}</span>
            <span className="bg-muted relative h-6 overflow-hidden rounded-md">
              <span
                className="absolute inset-y-0 left-0 rounded-md"
                style={{
                  width: `${Math.max(s.value ? 2 : 0, share)}%`,
                  background: s.tone === "good" ? SERIES.good : s.tone === "bad" ? SERIES.attention : i === 0 ? SERIES.neutral : SERIES.brand,
                }}
              />
            </span>
            <span className="text-right tabular-nums whitespace-nowrap">
              <span className="font-semibold">{s.value.toLocaleString("en-AE")}</span>
              <span className="text-muted-foreground ml-1.5 text-xs">{i === 0 ? "" : `${share}%`}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A single share as a ring with the figure in the middle (adherence, renewal rate). */
export function ShareRing({ value, label, tone = "brand" }: { value: number | null; label: string; tone?: "brand" | "good" | "bad" }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  const color = tone === "good" ? SERIES.good : tone === "bad" ? SERIES.attention : SERIES.brand;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-24 shrink-0 -rotate-90" role="img" aria-label={`${label}: ${value === null ? "no data" : `${plain(v)}%`}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--muted)" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{value === null ? "—" : `${plain(v)}%`}</p>
        <p className="text-muted-foreground text-sm">{label}</p>
      </div>
    </div>
  );
}

/** One part of a whole, as a single stacked bar with its legend (early / within / late). */
export function SplitBar({ parts }: { parts: Array<{ label: string; value: number; color: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="grid gap-2">
      <div className="bg-muted flex h-3 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {total
          ? parts.map((p) => (p.value ? <span key={p.label} className="h-full border-r-2 border-[var(--card)] last:border-r-0" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null))
          : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="font-medium tabular-nums">{p.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Chart or table, switched in a card's header; the chart first. */
export function useChartView() {
  const [view, setView] = useState<"chart" | "table">("chart");
  const toggle = (
    <div className="bg-muted/60 inline-flex rounded-lg p-0.5" role="group" aria-label="Show as">
      {(["chart", "table"] as const).map((v) => (
        <Button
          key={v}
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={view === v}
          className={cn("h-7 gap-1.5 px-2.5 text-xs", view === v ? "bg-card shadow-sm" : "text-muted-foreground")}
          onClick={() => setView(v)}
        >
          {v === "chart" ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
          {v === "chart" ? "Chart" : "Table"}
        </Button>
      ))}
    </div>
  );
  return { view, toggle };
}

/* ------------------------------------------------------------------ */
/* The period: presets and the date range picker Finance uses          */
/* ------------------------------------------------------------------ */

export interface PeriodPreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

/**
 * The report period (23 Nov 2026): a preset list and the same two-month
 * date range picker as Finance's reports, in one bar that says what is
 * shown.
 */
export function PeriodBar({
  from,
  to,
  presets,
  onChange,
  summary,
  actions,
}: {
  from: string;
  to: string;
  presets: PeriodPreset[];
  onChange: (from: string, to: string) => void;
  summary: ReactNode;
  /** Buttons at the bar's right end, level with the pickers (the page's Export, 25 Nov 2026). */
  actions?: ReactNode;
}) {
  const active = presets.find((p) => p.from === from && p.to === to)?.key ?? "custom";
  return (
    <div className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <CalendarRange className="text-muted-foreground size-4 shrink-0" />
        <span className="text-muted-foreground">Showing</span>
        <span className="truncate font-medium">{summary}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={active}
          onValueChange={(key) => {
            const p = presets.find((x) => x.key === key);
            if (p) onChange(p.from, p.to);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
            {active === "custom" ? <SelectItem value="custom">Custom dates</SelectItem> : null}
          </SelectContent>
        </Select>
        <DateRangePicker from={from} to={to} label="Report dates" onChange={onChange} />
        {actions}
      </div>
    </div>
  );
}

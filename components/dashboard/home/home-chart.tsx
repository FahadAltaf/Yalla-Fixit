"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { HomeChart, HomeChartPoint } from "@/lib/home/summary";

/**
 * A module chart on the home dashboard (26 Nov 2026). One series per chart,
 * so the title names it and no legend box is needed; each bar is coloured
 * by what it means (lib/snagging/chart-palette.ts: attention, in flight,
 * done, or neutral) and opens the records behind it. A table of the same
 * figures is there for screen readers.
 */
export function HomeChartCard({ chart, icon, onSelect }: { chart: HomeChart; icon: ReactNode; onSelect: (point: HomeChartPoint) => void }) {
  const config = { value: { label: chart.unit } } satisfies ChartConfig;
  const total = chart.points.reduce((s, p) => s + p.value, 0);
  const horizontal = chart.layout === "horizontal";

  return (
    <SectionCard
      icon={icon}
      title={chart.title}
      description={`${chart.description} ${total.toLocaleString("en-AE")} in all; click a bar to see them.`}
      bodyClassName="px-4 pb-4"
    >
      <ChartContainer config={config} className={horizontal ? "h-52 w-full" : "h-56 w-full"}>
        {horizontal ? (
          <BarChart data={chart.points} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.15))]} />
            <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={108} tickMargin={4} />
            <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent labelKey="label" hideIndicator />} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26} className="cursor-pointer" onClick={(d) => onSelect((d as unknown as { payload: HomeChartPoint }).payload)}>
              {chart.points.map((p) => (
                <Cell key={p.key} fill={p.color} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <BarChart data={chart.points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.15))]} />
            <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent labelKey="label" hideIndicator />} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} className="cursor-pointer" onClick={(d) => onSelect((d as unknown as { payload: HomeChartPoint }).payload)}>
              {chart.points.map((p) => (
                <Cell key={p.key} fill={p.color} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartContainer>
      <table className="sr-only">
        <caption>{chart.title}</caption>
        <tbody>
          {chart.points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}

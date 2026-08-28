"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Cell, Label, Pie, PieChart } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";

import { SEVERITY_COLOR } from "@/lib/snagging/chart-palette";

import { DonutSkeleton, SectionShell } from "./section-shell";
import { useSection } from "./use-section";

type Severity = { total: number; levels: Array<{ severity: string; count: number }> };

const config = {
  count: { label: "Open snags" },
  high: { label: "High" },
  medium: { label: "Medium" },
  low: { label: "Low" },
} satisfies ChartConfig;

/**
 * Open snags by severity (§5).
 *
 * Severity escalates in the colour as well as in the word: neutral,
 * amber, red. The arcs and the legend read the same map, so a swatch
 * can never disagree with the wedge it stands for — which is how High
 * previously ended up with no colour at all while Medium wore the red.
 */
const FILL = SEVERITY_COLOR;

export function SnagSeverity() {
  const router = useRouter();
  const { data, loading, error, reload } = useSection<Severity>(
    "/api/snagging/overview/snag-severity",
    { staleMs: 600_000 },
  );

  const rows = (data?.levels ?? []).map((level) => ({
    ...level,
    label: level.severity.charAt(0).toUpperCase() + level.severity.slice(1),
  }));

  return (
    <SectionShell
      title="Snag severity"
      description="Outstanding defects, by how badly they need fixing."
      icon={<ShieldAlert />}
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!loading && (data?.total ?? 0) === 0}
      empty={
        <EmptyState
          icon={<ShieldAlert />}
          title="No open snags"
          description="Every recorded defect has been closed off."
          className="py-10"
        />
      }
      skeleton={<DonutSkeleton />}
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <ChartContainer config={config} className="h-52 min-w-0 flex-1">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="label" hideLabel />} />
            <Pie data={rows} dataKey="count" nameKey="label" innerRadius={52} strokeWidth={2}>
              {rows.map((row) => (
                <Cell
                  key={row.severity}
                  fill={FILL[row.severity]}
                  className="cursor-pointer"
                  onClick={() => router.push(`/snagging/jobs?severity=${row.severity}`)}
                />
              ))}
              <Label
                content={({ viewBox }) =>
                  viewBox && "cx" in viewBox ? (
                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className="fill-foreground text-2xl font-semibold"
                      >
                        {data?.total ?? 0}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 20}
                        className="fill-muted-foreground text-xs"
                      >
                        open
                      </tspan>
                    </text>
                  ) : null
                }
              />
            </Pie>
          </PieChart>
        </ChartContainer>

        {/* The legend carries the numbers, so nothing here is read from
            colour alone. */}
        <ul className="w-full shrink-0 space-y-2 sm:w-40">
          {rows.map((row) => (
            <li key={row.severity} className="flex items-center gap-2 text-sm">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: FILL[row.severity] }}
                aria-hidden
              />
              <span className="flex-1">{row.label}</span>
              <span className="font-medium tabular-nums">{row.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}

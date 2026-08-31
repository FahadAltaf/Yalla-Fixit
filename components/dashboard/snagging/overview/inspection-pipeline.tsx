"use client";

import { useRouter } from "next/navigation";
import { GitBranch } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";

import { CHART_COLOR, PIPELINE_COLOR } from "@/lib/snagging/chart-palette";

import { ChartSkeleton, SectionShell } from "./section-shell";
import { useSection } from "./use-section";

type Pipeline = { stages: Array<{ status: string; label: string; count: number }> };

const config = { count: { label: "Jobs" } } satisfies ChartConfig;

/**
 * How much work is sitting at each stage (§3).
 *
 * Each stage takes its colour from the shared pipeline map, so the six
 * are distinguishable and each one means something: neutral before work
 * starts, amber while it is in flight, up the brand ramp through review,
 * green once it lands. Clicking a bar opens the jobs at that stage.
 */
export function InspectionPipeline() {
  const router = useRouter();
  const { data, loading, error, reload } = useSection<Pipeline>(
    "/api/snagging/overview/pipeline",
    { staleMs: 60_000 },
  );

  const total = (data?.stages ?? []).reduce((sum, stage) => sum + stage.count, 0);

  return (
    <SectionShell
      title="Inspection pipeline"
      description="Where every open job is sitting. Click a stage to open it."
      icon={<GitBranch />}
      centerBody
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!loading && total === 0}
      empty={
        <EmptyState
          icon={<GitBranch />}
          title="No jobs in the pipeline"
          description="Nothing is assigned, in progress, or waiting to be signed off."
          className="py-10"
        />
      }
      skeleton={<ChartSkeleton bars={6} />}
    >
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart
          data={data?.stages ?? []}
          layout="vertical"
          margin={{ left: 8, right: 16 }}
        >
          <CartesianGrid horizontal={false} />
          {/*
            Scaled to the data, not to a fixed ceiling. A pipeline whose
            busiest stage holds one job was drawing an axis to four and
            leaving three quarters of the card empty.
          */}
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax * 1.2))]}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={86}
            tickMargin={4}
          />
          <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} className="cursor-pointer">
            {(data?.stages ?? []).map((stage) => (
              <Cell
                key={stage.status}
                fill={PIPELINE_COLOR[stage.status] ?? CHART_COLOR.neutral}
                onClick={() => router.push(`/snagging/jobs?status=${stage.status}`)}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </SectionShell>
  );
}

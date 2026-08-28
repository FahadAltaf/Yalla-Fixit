"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarIcon,
  ChevronDown,
  Download,
  FileSpreadsheet,
  HardHat,
  Hourglass,
  Inbox,
  UserRound,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { DataTable } from "@/components/data-table";
import {
  getSnaggingDeveloperColumns,
  getSnaggingInspectorColumns,
} from "@/components/data-table/columns/column-snagging-analytics";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type SnaggingAnalytics,
  type SnaggingAnalyticsGranularity,
} from "@/types/types";

import { AnalyticsDrilldown, type DrilldownRequest } from "./analytics-drilldown";
import {
  DataState,
  PageHeading,
  PillTabs,
  SectionCard,
  SectionSkeleton,
  StatCard,
  StatGridSkeleton,
  TaskStatusBadge,
  timeAgo,
} from "./shared";

/** A shadcn date picker (Popover + Calendar) writing a YYYY-MM-DD string. */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const date = value ? parseISO(value) : undefined;
  return (
    <div className="text-sm">
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-40 justify-start text-left font-normal",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 size-4" />
            {date ? format(date, "dd MMM yyyy") : label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** CSV or Excel, for one table (FR-10.06). */
function ExportMenu({ onExport, disabled }: { onExport: (format: ExportFormat) => void; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Download className="size-4" />
          Export
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onExport("csv")}>
          <Download className="size-4" />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("xlsx")}>
          <FileSpreadsheet className="size-4" />
          Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const GRANULARITY_TABS = [
  { value: "day" as const, label: "Day" },
  { value: "week" as const, label: "Week" },
  { value: "month" as const, label: "Month" },
];

const QUEUE_BANDS = [
  { bucket: "under_24h" as const, label: "Under 24 hours", tone: "text-success" },
  { bucket: "h24_48" as const, label: "24 to 48 hours", tone: "text-warning" },
  { bucket: "over_48h" as const, label: "Over 48 hours", tone: "text-danger" },
];

const completedChartConfig = {
  count: { label: "Completed", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Operations analytics (FR-10.01 to FR-10.06).
 *
 * The order is the order an ops lead asks the questions in: how long is
 * everything taking, what is waiting, how much went out, and only then
 * who and which developer.
 *
 * Two things are deliberately not on this page. There is no severity or
 * element distribution (FR-10.05) — those compare nothing across
 * projects and belong in the client report — and there is no snag count
 * against an inspector (FR-10.04), because snag volume measures the
 * building somebody was sent to, not how well they walked it.
 *
 * Every figure opens the records behind it (FR-10.06), and every list
 * exports as CSV or Excel.
 */
export default function SnaggingAnalyticsDashboard() {
  const { userProfile } = useAuth();
  const [data, setData] = useState<SnaggingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [granularity, setGranularity] = useState<SnaggingAnalyticsGranularity>("day");
  const [drilldown, setDrilldown] = useState<DrilldownRequest | null>(null);
  const [developerPage, setDeveloperPage] = useState(0);
  const [developerPageSize, setDeveloperPageSize] = useState(10);
  const [inspectorPage, setInspectorPage] = useState(0);
  const [inspectorPageSize, setInspectorPageSize] = useState(10);

  const canExport = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EXPORT);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // A new date range is a different list; staying on page 4 of the old
    // one would land on an empty table.
    setDeveloperPage(0);
    setInspectorPage(0);
    try {
      setData(await snaggingService.getAnalytics({ from, to, granularity }));
    } catch (err) {
      // A toast here left the page on a permanent skeleton, which reads
      // as "still working" rather than "the request failed".
      setError(err instanceof Error ? err.message : "Could not load analytics");
    } finally {
      setLoading(false);
    }
  }, [from, to, granularity]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Opens the records behind a figure, in the dates currently selected. */
  const open = useCallback(
    (request: Omit<DrilldownRequest, "from" | "to" | "granularity">) => {
      setDrilldown({ ...request, from, to, granularity });
    },
    [from, to, granularity],
  );

  const developerRows = useMemo(() => data?.byDeveloper ?? [], [data]);
  const inspectorRows = useMemo(() => data?.byInspector ?? [], [data]);

  // Both breakdowns arrive whole with the analytics payload, so the page
  // is sliced here rather than round-tripping — the same shape the
  // catalogue and roles tables use against the shared DataTable.
  const developerPageRows = useMemo(() => {
    const start = developerPage * developerPageSize;
    return developerRows.slice(start, start + developerPageSize);
  }, [developerRows, developerPage, developerPageSize]);

  const inspectorPageRows = useMemo(() => {
    const start = inspectorPage * inspectorPageSize;
    return inspectorRows.slice(start, start + inspectorPageSize);
  }, [inspectorRows, inspectorPage, inspectorPageSize]);

  function exportDevelopers(format: ExportFormat) {
    exportTable({
      columns: [
        { key: "developer_name", label: "Developer" },
        { key: "unit_count", label: "Units inspected" },
        { key: "snag_count", label: "Snags" },
        { key: "snags_per_unit", label: "Snags per unit" },
        { key: "outstanding_count", label: "Still outstanding" },
        { key: "defect_mix", label: "Defect mix" },
      ],
      rows: developerRows.map((row) => ({
        ...row,
        defect_mix: row.defect_mix.map((entry) => `${entry.label} (${entry.count})`).join("; "),
      })),
      filename: exportFilename(["snagging", "developers", from, to]),
      format,
      sheetName: "Developers",
    });
  }

  function exportInspectors(format: ExportFormat) {
    exportTable({
      columns: [
        { key: "name", label: "Inspector" },
        { key: "inspection_count", label: "Inspections" },
        { key: "avgMinutesPerInspection", label: "Average minutes per inspection" },
        { key: "timedSample", label: "Inspections timed" },
      ],
      rows: inspectorRows,
      filename: exportFilename(["snagging", "inspectors", from, to]),
      format,
      sheetName: "Inspectors",
    });
  }

  const statusTotal = (data?.byStatus ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Snagging analytics"
        description="Throughput, turnaround, and where the work is sitting. Every figure opens the jobs behind it."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
          </div>
        }
      />

      <DataState
        loading={loading}
        error={error}
        onRetry={() => void load()}
        retrying={loading}
        errorTitle="Could not load analytics"
        skeleton={
          // The whole page, not just the top row: the charts and tables
          // used to pop in under a settled header and shift the layout.
          <div className="flex flex-col gap-6">
            <StatGridSkeleton count={5} />
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionSkeleton />
              <SectionSkeleton />
            </div>
            <SectionSkeleton />
            {/*
              No table-shaped placeholder for the two breakdowns below:
              they are DataTables and render their own in-body skeleton
              rows, so a second, differently-shaped skeleton would only
              make the load flicker between two looks.
            */}
            <SectionSkeleton />
            <SectionSkeleton />
          </div>
        }
      >
        {data ? (
          <div className="flex flex-col gap-6">
            {/* FR-10.02 — the five time metrics. */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Average time on site"
                value={formatMinutes(data.timeMetrics.avgMinutesOnSite)}
                headline="Arrival to submission"
                caption={sampleCaption(data.timeMetrics.onSiteSample, "walk")}
                onSelect={() => open({ metric: "time_on_site" })}
              />
              <StatCard
                label="Average submit to approval"
                value={formatMinutes(data.timeMetrics.avgSubmitToApprovalMinutes)}
                headline="How long the office took"
                caption={sampleCaption(data.timeMetrics.submitToApprovalSample, "approval")}
                onSelect={() => open({ metric: "submit_to_approval" })}
              />
              <StatCard
                label="First-time approval"
                value={percent(data.timeMetrics.firstTimeApprovalRate)}
                headline={
                  data.timeMetrics.firstTimeApprovalRate === null
                    ? "Nothing approved yet"
                    : "Approved without being sent back"
                }
                caption={sampleCaption(data.timeMetrics.firstTimeApprovalSample, "approval")}
                tone={(data.timeMetrics.firstTimeApprovalRate ?? 0) >= 90 ? "good" : "neutral"}
                onSelect={() => open({ metric: "first_time_approval", value: "first_time" })}
              />
              <StatCard
                label="Delivered within 24 hours"
                value={percent(data.timeMetrics.deliveredWithin24hRate)}
                headline={
                  data.timeMetrics.deliveredWithin24hRate === null
                    ? "Nothing delivered yet"
                    : "Approval to the client"
                }
                caption={sampleCaption(data.timeMetrics.deliveredSample, "report")}
                tone={(data.timeMetrics.deliveredWithin24hRate ?? 0) >= 95 ? "good" : "neutral"}
                onSelect={() => open({ metric: "delivered_sla", value: "within" })}
              />
              <StatCard
                label="Approvals overdue"
                value={data.timeMetrics.overdueApprovals}
                headline="Past the 48-hour escalation point"
                caption="Live — not filtered by the dates above"
                tone={data.timeMetrics.overdueApprovals > 0 ? "bad" : "good"}
                onSelect={() => open({ metric: "overdue_approvals" })}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* FR-10.01 — jobs by status. */}
              <SectionCard
                title="Jobs by status"
                description={`${statusTotal} raised in this period`}
                bodyClassName="px-5 pb-5"
              >
                {data.byStatus.length === 0 ? (
                  <EmptyState
                    icon={<Inbox />}
                    title="No jobs raised in this period"
                    description="Widen the dates to look further back."
                    className="py-8"
                  />
                ) : (
                  <div className="space-y-3">
                    {data.byStatus.map((row) => (
                      <button
                        key={row.status}
                        type="button"
                        onClick={() => open({ metric: "status", value: row.status })}
                        className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span className="w-28 shrink-0">
                          <TaskStatusBadge status={row.status} />
                        </span>
                        <Progress
                          value={statusTotal ? (row.count / statusTotal) * 100 : 0}
                          className="flex-1"
                        />
                        <span className="w-10 text-right text-sm tabular-nums">{row.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* FR-10.01 — the review queue by submission time. */}
              <SectionCard
                title="Waiting on review"
                description={
                  data.reviewQueue.oldestSubmittedAt
                    ? `${data.reviewQueue.total} submitted and unapproved. Oldest ${timeAgo(data.reviewQueue.oldestSubmittedAt)}.`
                    : "Nothing is waiting on a reviewer."
                }
                bodyClassName="px-5 pb-5"
              >
                <div className="space-y-3">
                  {QUEUE_BANDS.map((band) => {
                    const count =
                      data.reviewQueue.buckets.find((entry) => entry.bucket === band.bucket)
                        ?.count ?? 0;
                    return (
                      <button
                        key={band.bucket}
                        type="button"
                        disabled={count === 0}
                        onClick={() => open({ metric: "review_queue", value: band.bucket })}
                        className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
                      >
                        <span className="w-36 shrink-0 text-sm">{band.label}</span>
                        <Progress
                          value={
                            data.reviewQueue.total ? (count / data.reviewQueue.total) * 100 : 0
                          }
                          className="flex-1"
                        />
                        <span
                          className={cn(
                            "w-10 text-right text-sm font-medium tabular-nums",
                            count > 0 && band.tone,
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-muted-foreground mt-4 text-xs">
                  A live queue, so it ignores the dates above. Time bands are labelled as well as
                  coloured.
                </p>
              </SectionCard>
            </div>

            {/* FR-10.01 — jobs completed by day, week or month. */}
            <SectionCard
              title="Jobs completed"
              description={`${data.completed.total} counted at approval. Click a bar for the jobs in that period.`}
              action={
                <PillTabs
                  tabs={GRANULARITY_TABS}
                  value={granularity}
                  onChange={setGranularity}
                />
              }
              bodyClassName="px-5 pb-5"
            >
              {data.completed.total === 0 ? (
                <EmptyState
                  icon={<Hourglass />}
                  title="Nothing approved in this period"
                  description="A job counts as completed when it is approved. Widen the dates, or check the review queue above."
                  className="py-8"
                />
              ) : (
                <ChartContainer config={completedChartConfig} className="h-64 w-full">
                  <BarChart data={data.completed.points} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={16}
                    />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                    <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
                    <Bar
                      dataKey="count"
                      fill="var(--color-count)"
                      radius={[4, 4, 0, 0]}
                      className="cursor-pointer"
                      onClick={(entry: { period?: string }) =>
                        entry.period ? open({ metric: "completed", value: entry.period }) : undefined
                      }
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </SectionCard>

            {/* FR-10.03 — developer view. */}
            <SectionCard
              title="Developer view"
              description="Units inspected, snags per unit, and what those units keep failing on."
              action={
                canExport ? (
                  <ExportMenu onExport={exportDevelopers} disabled={developerRows.length === 0} />
                ) : null
              }
            >
              <DataTable
                data={developerPageRows}
                columns={getSnaggingDeveloperColumns()}
                // A breakdown, not a list to search: the heading above
                // already says what these rows are, so no toolbar.
                onGlobalFilterChange={() => {}}
                onPageChange={setDeveloperPage}
                onPageSizeChange={(size) => {
                  setDeveloperPageSize(size);
                  setDeveloperPage(0);
                }}
                pageSize={developerPageSize}
                currentPage={developerPage}
                loading={loading}
                rowCount={developerRows.length}
                type="snagging-analytics-developer"
                isPagination={true}
                handleRowClick={(row) =>
                  open({ metric: "developer", value: row.developer_name })
                }
                emptyState={
                  <EmptyState
                    icon={<HardHat />}
                    title="No developer data in this period"
                    description="Snag rates appear here once inspections in these dates carry a developer on the property record."
                  />
                }
              />
            </SectionCard>

            {/* FR-10.04 — inspector view. */}
            <SectionCard
              title="Inspector view"
              description="Inspections carried out and how long each took. Snag count is not shown: it measures the building, not the inspector."
              action={
                canExport ? (
                  <ExportMenu onExport={exportInspectors} disabled={inspectorRows.length === 0} />
                ) : null
              }
            >
              <DataTable
                data={inspectorPageRows}
                columns={getSnaggingInspectorColumns()}
                onGlobalFilterChange={() => {}}
                onPageChange={setInspectorPage}
                onPageSizeChange={(size) => {
                  setInspectorPageSize(size);
                  setInspectorPage(0);
                }}
                pageSize={inspectorPageSize}
                currentPage={inspectorPage}
                loading={loading}
                rowCount={inspectorRows.length}
                type="snagging-analytics-inspector"
                isPagination={true}
                handleRowClick={(row) => open({ metric: "inspector", value: row.user_id })}
                emptyState={
                  <EmptyState
                    icon={<UserRound />}
                    title="No inspections assigned in this period"
                    description="Nobody walked a unit between these dates. Widen the range to see earlier activity."
                  />
                }
              />
            </SectionCard>
          </div>
        ) : null}
      </DataState>

      <AnalyticsDrilldown
        request={drilldown}
        onClose={() => setDrilldown(null)}
        canExport={canExport}
      />
    </div>
  );
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/**
 * How many records the average was taken over.
 *
 * An average of one job and an average of ninety look identical on a
 * card, and only one of them is a measurement.
 */
function sampleCaption(sample: number, noun: string): string {
  if (sample === 0) return `No ${noun}s in this period`;
  return `Over ${sample} ${sample === 1 ? noun : `${noun}s`}`;
}

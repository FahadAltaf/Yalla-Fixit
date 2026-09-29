"use client";

import { useCallback, useState } from "react";
import {
  CalendarIcon,
  CheckCircle2,
  HardHat,
  Hourglass,
  Inbox,
  TrendingDown,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table";
import {
  getSnaggingDeveloperColumns,
  getSnaggingInspectorColumns,
  type SnaggingDeveloperRow,
} from "@/components/data-table/columns/column-snagging-analytics";
import { DeveloperDefectsDialog } from "./developer-defects-dialog";
import { ExportMenu } from "./export-menu";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import {
  exportFilename,
  exportTable,
  type ExportFormat,
} from "@/lib/snagging/export-table";
import { cn } from "@/lib/utils";
import { CHART_COLOR, PIPELINE_COLOR } from "@/lib/snagging/chart-palette";
import { TASK_STATUS_LABELS } from "@/lib/snagging/status-labels";
import {
  ActionType,
  ResourceType,
  type SnaggingAnalytics,
  type SnaggingAnalyticsGranularity,
} from "@/types/types";

import { SnagsByCategory } from "./overview/snags-by-category";
import {
  ChartSkeleton,
  InlineError,
  SectionShell,
  TableSkeleton,
} from "./overview/section-shell";
import { useSection, type Section } from "./overview/use-section";
import {
  AnalyticsDrilldown,
  type DrilldownRequest,
} from "./analytics-drilldown";
import {
  PageHeading,
  PillTabs,
  StatCard,
  StatCardGrid,
  timeAgo,
} from "./shared";

/** Today as YYYY-MM-DD on the reader's own calendar. */
function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * A shadcn date picker (Popover + Calendar) writing a YYYY-MM-DD string.
 * Days outside `min`..`max` cannot be picked, and a date cannot be
 * cleared: a range always has both ends.
 */
function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  const date = value ? parseISO(value) : undefined;
  const disabled = [
    ...(min ? [{ before: parseISO(min) }] : []),
    ...(max ? [{ after: parseISO(max) }] : []),
  ];
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
            defaultMonth={date}
            disabled={disabled}
            endMonth={max ? parseISO(max) : undefined}
            onSelect={(d) => {
              if (d) onChange(format(d, "yyyy-MM-dd"));
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* Stands in while a refresh is in flight, or when the dates drop a developer. */
const EMPTY_DEVELOPER: SnaggingDeveloperRow = {
  developer_name: "",
  unit_count: 0,
  snag_count: 0,
  snags_per_unit: 0,
  outstanding_count: 0,
  unit_trend: 0,
  last_inspection_at: null,
  defect_mix: [],
};

const GRANULARITY_TABS = [
  { value: "day" as const, label: "Day" },
  { value: "week" as const, label: "Week" },
  { value: "month" as const, label: "Month" },
];

const QUEUE_BANDS = [
  {
    bucket: "under_24h" as const,
    label: "Under 24 hours",
    tone: "text-success",
  },
  { bucket: "h24_48" as const, label: "24 to 48 hours", tone: "text-warning" },
  { bucket: "over_48h" as const, label: "Over 48 hours", tone: "text-danger" },
];

/*
  Completions are neutral, not red. Nothing here missed a deadline —
  red on this page is reserved for the overdue-approvals figure and for
  a defect that keeps recurring.
*/
const completedChartConfig = {
  count: { label: "Completed", color: CHART_COLOR.neutral },
} satisfies ChartConfig;

/*
  What each `?section=` of /api/snagging/analytics answers with. The
  shapes are the whole payload's, cut per card, so the two can never
  drift apart. The overdue count travels with the queue: it is the
  queue's oldest band, and both are live rather than dated.
*/
type TimeMetrics = Omit<SnaggingAnalytics["timeMetrics"], "overdueApprovals">;
type ReviewQueue = SnaggingAnalytics["reviewQueue"] & {
  overdueApprovals: number;
};

const ANALYTICS_URL = "/api/snagging/analytics";

/**
 * One card's request. The dates are left off a live section on
 * purpose: its URL then stays the same whatever range is picked, so
 * changing the dates does not refetch a queue they do not affect.
 */
function sectionUrl(
  section: string,
  range?: { from: string; to: string },
): string {
  const params = new URLSearchParams({ section, ...range });
  return `${ANALYTICS_URL}?${params.toString()}`;
}

/**
 * A section's data only once it is current.
 *
 * `useSection` keeps the last response while a new one is in flight, so
 * without this a card would briefly describe the previous date range in
 * its header while its body showed a skeleton for the new one.
 */
function settled<T>(section: Section<T>): T | null {
  return section.loading || section.error ? null : section.data;
}

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
 * Every card loads on its own, the way the Overview does. The page used
 * to wait on one request for everything, so the quick figures sat behind
 * the developer breakdown and one failing query put the whole page into
 * an error. Now each card has its own skeleton, fills in when its own
 * figures arrive, and offers its own retry.
 *
 * Every figure opens the records behind it (FR-10.06), and every list
 * exports as CSV or Excel.
 */
export default function SnaggingAnalyticsDashboard() {
  const { userProfile } = useAuth();
  // Local calendar dates: toISOString() gave yesterday's date to anyone
  // east of UTC before their clock passed UTC midnight.
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return format(date, "yyyy-MM-dd");
  });
  const [to, setTo] = useState(todayIso);
  // The developer whose defects are open in a popup, by name, so a
  // refresh shows their new figures rather than the ones it opened with.
  const [defectsFor, setDefectsFor] = useState<string | null>(null);
  const [granularity, setGranularity] =
    useState<SnaggingAnalyticsGranularity>("day");
  const [drilldown, setDrilldown] = useState<DrilldownRequest | null>(null);
  const [developerPage, setDeveloperPage] = useState(0);
  const [developerPageSize, setDeveloperPageSize] = useState(10);
  const [inspectorPage, setInspectorPage] = useState(0);
  const [inspectorPageSize, setInspectorPageSize] = useState(10);

  const canExport = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EXPORT,
  );

  /*
    One request per card. The dates ride in each URL, and `useSection`
    is keyed by URL, so a new range refetches every dated card and each
    range is cached separately. The chart's grain is deliberately not in
    the URL: every grain is already in the completed payload, so
    switching between day, week and month must not refetch.
  */
  const range = { from, to };
  const time = useSection<TimeMetrics>(sectionUrl("time", range));
  // A live queue: no dates (see its copy below).
  const queue = useSection<ReviewQueue>(sectionUrl("queue"));
  const status = useSection<SnaggingAnalytics["byStatus"]>(
    sectionUrl("status", range),
  );
  const completed = useSection<SnaggingAnalytics["completed"]>(
    sectionUrl("completed", range),
  );
  const developers = useSection<SnaggingAnalytics["byDeveloper"]>(
    sectionUrl("developers", range),
  );
  const inspectors = useSection<SnaggingAnalytics["byInspector"]>(
    sectionUrl("inspectors", range),
  );

  const timeData = settled(time);
  const queueData = settled(queue);
  const statusRows = settled(status);
  const completedData = settled(completed);

  // A new date range is a different list; staying on page 4 of the old
  // one would land on an empty table.
  function changeFrom(value: string) {
    setFrom(value);
    setDeveloperPage(0);
    setInspectorPage(0);
  }
  function changeTo(value: string) {
    setTo(value);
    setDeveloperPage(0);
    setInspectorPage(0);
  }

  /** Opens the records behind a figure, in the dates currently selected. */
  const open = useCallback(
    (request: Omit<DrilldownRequest, "from" | "to" | "granularity">) => {
      setDrilldown({ ...request, from, to, granularity });
    },
    [from, to, granularity],
  );

  const developerRows = settled(developers) ?? [];
  const inspectorRows = settled(inspectors) ?? [];

  // Both breakdowns arrive whole with their section, so the page is
  // sliced here rather than round-tripping — the same shape the
  // catalogue and roles tables use against the shared DataTable.
  const developerStart = developerPage * developerPageSize;
  const developerPageRows = developerRows.slice(
    developerStart,
    developerStart + developerPageSize,
  );
  const inspectorStart = inspectorPage * inspectorPageSize;
  const inspectorPageRows = inspectorRows.slice(
    inspectorStart,
    inspectorStart + inspectorPageSize,
  );

  function exportDevelopers(format: ExportFormat) {
    void exportTable({
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
        defect_mix: row.defect_mix
          .map((entry) => `${entry.label} (${entry.count})`)
          .join("; "),
      })),
      filename: exportFilename(["snagging", "developers", from, to]),
      format,
      sheetName: "Developers",
    });
  }

  function exportInspectors(format: ExportFormat) {
    void exportTable({
      columns: [
        { key: "name", label: "Inspector" },
        { key: "inspection_count", label: "Inspections" },
        {
          key: "avgMinutesPerInspection",
          label: "Average minutes per inspection",
        },
        { key: "timedSample", label: "Inspections timed" },
      ],
      rows: inspectorRows,
      filename: exportFilename(["snagging", "inspectors", from, to]),
      format,
      sheetName: "Inspectors",
    });
  }

  const statusTotal = (statusRows ?? []).reduce(
    (sum, row) => sum + row.count,
    0,
  );

  // The dialog keeps the figures it has while its own refresh is in
  // flight, rather than blanking behind the reader.
  const dialogDevelopers = developers.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Snagging analytics"
        description="Throughput, turnaround, and where the work is sitting. Every figure opens the jobs behind it."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {/* From runs up to To; To runs from From up to today. */}
            <DateField label="From" value={from} onChange={changeFrom} max={to} />
            <DateField label="To" value={to} onChange={changeTo} min={from} max={todayIso()} />
          </div>
        }
      />

      <div className="flex flex-col gap-6">
        {/*
          FR-10.02 — the five time metrics, as two sections in one row.
          The four period figures share one request; the overdue count is
          live and comes with the review queue, so a slow or failed one
          leaves the other standing.
        */}
        <StatCardGrid columns={5}>
          {time.error ? (
            <div className="@xl/main:col-span-2 @5xl/main:col-span-4">
              <InlineError message={time.error} onRetry={time.reload} />
            </div>
          ) : !timeData ? (
            Array.from({ length: 4 }).map((_, index) => (
              <StatTileSkeleton key={index} />
            ))
          ) : (
            <>
              <StatCard
                label="Average time on site"
                value={formatMinutes(timeData.avgMinutesOnSite)}
                headline="Arrival to submission"
                caption={sampleCaption(timeData.onSiteSample, "walk")}
                onSelect={() => open({ metric: "time_on_site" })}
              />
              <StatCard
                label="Average submit to approval"
                value={formatMinutes(timeData.avgSubmitToApprovalMinutes)}
                headline="How long the office took"
                caption={sampleCaption(
                  timeData.submitToApprovalSample,
                  "approval",
                )}
                onSelect={() => open({ metric: "submit_to_approval" })}
              />
              <StatCard
                label="First-time approval"
                value={percent(timeData.firstTimeApprovalRate)}
                headline={
                  timeData.firstTimeApprovalRate === null
                    ? "Nothing approved yet"
                    : "Approved without being sent back"
                }
                caption={sampleCaption(
                  timeData.firstTimeApprovalSample,
                  "approval",
                )}
                tone={
                  (timeData.firstTimeApprovalRate ?? 0) >= 90
                    ? "good"
                    : "neutral"
                }
                onSelect={() =>
                  open({ metric: "first_time_approval", value: "first_time" })
                }
              />
              <StatCard
                label="Delivered within 24 hours"
                value={percent(timeData.deliveredWithin24hRate)}
                headline={
                  timeData.deliveredWithin24hRate === null
                    ? "Nothing delivered yet"
                    : "Approval to the client"
                }
                caption={sampleCaption(timeData.deliveredSample, "report")}
                tone={
                  (timeData.deliveredWithin24hRate ?? 0) >= 95
                    ? "good"
                    : "neutral"
                }
                onSelect={() =>
                  open({ metric: "delivered_sla", value: "within" })
                }
              />
            </>
          )}
          {queue.error ? (
            <InlineError message={queue.error} onRetry={queue.reload} />
          ) : !queueData ? (
            <StatTileSkeleton />
          ) : (
            <StatCard
              label="Approvals overdue"
              value={queueData.overdueApprovals}
              headline="Past the 48-hour escalation point"
              caption="Live figures, not filtered by the dates above"
              tone={queueData.overdueApprovals > 0 ? "bad" : "good"}
              onSelect={() => open({ metric: "overdue_approvals" })}
            />
          )}
        </StatCardGrid>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* FR-10.01 — jobs by status. */}
          <SectionShell
            title="Jobs by status"
            icon={<Inbox />}
            description={
              statusRows
                ? `${statusTotal} raised in this period`
                : "Jobs raised in this period"
            }
            loading={!statusRows}
            error={status.error}
            onRetry={status.reload}
            isEmpty={statusRows?.length === 0}
            empty={
              <EmptyState
                icon={<Inbox />}
                title="No jobs raised in this period"
                description="Widen the dates to look further back."
                className="py-8"
              />
            }
            skeleton={<BarRowsSkeleton rows={5} />}
          >
            <div className="space-y-3">
              {(statusRows ?? []).map((row) => (
                <button
                  key={row.status}
                  type="button"
                  onClick={() => open({ metric: "status", value: row.status })}
                  className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  {/* Plain text, not a status pill: the coloured bar
                      beside it already carries the stage colour, and a
                      column of pills made five rows of chrome out of what
                      is a simple labelled list. */}
                  <span className="w-28 shrink-0 truncate text-sm">
                    {TASK_STATUS_LABELS[row.status]}
                  </span>
                  {/* Same stage colours as the Overview pipeline —
                      one job status should not look like two
                      different things on two pages. */}
                  <Progress
                    value={statusTotal ? (row.count / statusTotal) * 100 : 0}
                    className="flex-1"
                    indicatorStyle={{
                      background:
                        PIPELINE_COLOR[row.status] ?? CHART_COLOR.neutral,
                    }}
                  />
                  <span className="w-10 text-right text-sm tabular-nums">
                    {row.count}
                  </span>
                  {/* <span className="w-20 shrink-0 text-right">
                    <StatusTrend value={row.trend} />
                  </span> */}
                </button>
              ))}
            </div>
          </SectionShell>

          {/* FR-10.01 — the review queue by submission time. */}
          <SectionShell
            title="Waiting on review"
            icon={<Hourglass />}
            description={
              queueData?.oldestSubmittedAt
                ? `Oldest submitted ${timeAgo(queueData.oldestSubmittedAt)}.`
                : "Submitted inspections, by how long they have been queued."
            }
            action={
              queueData ? (
                <Badge variant="secondary" className="font-medium">
                  {queueData.total} in queue
                </Badge>
              ) : null
            }
            loading={!queueData}
            error={queue.error}
            onRetry={queue.reload}
            skeleton={<BarRowsSkeleton rows={3} />}
          >
            {/*
              The three bands stay on screen at zero rather than
              giving way to an empty state. They are three short rows
              either way, and an empty queue reads perfectly well as
              three zeros — where the empty state put a large dashed
              panel in a card that is stretched to its neighbour, so
              the good news arrived as a hole in the page.
            */}
            <div className="space-y-3">
              {QUEUE_BANDS.map((band) => {
                const count =
                  queueData?.buckets.find(
                    (entry) => entry.bucket === band.bucket,
                  )?.count ?? 0;
                const total = queueData?.total ?? 0;
                return (
                  <button
                    key={band.bucket}
                    type="button"
                    disabled={count === 0}
                    onClick={() =>
                      open({ metric: "review_queue", value: band.bucket })
                    }
                    className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="w-36 shrink-0 text-sm">{band.label}</span>
                    <Progress
                      value={total ? (count / total) * 100 : 0}
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
              A live queue, so it ignores the dates above. Time bands are
              labelled as well as coloured.
            </p>
          </SectionShell>
        </div>

        {/* FR-10.01 — jobs completed by day, week or month. */}
        <SectionShell
          title="Jobs completed"
          icon={<CheckCircle2 />}
          description={
            completedData
              ? `${completedData.total} counted at approval. Click a bar for the jobs in that period.`
              : "Counted at approval. Click a bar for the jobs in that period."
          }
          action={
            <PillTabs
              tabs={GRANULARITY_TABS}
              value={granularity}
              onChange={setGranularity}
            />
          }
          loading={!completedData}
          error={completed.error}
          onRetry={completed.reload}
          isEmpty={completedData?.total === 0}
          empty={
            <EmptyState
              icon={<Hourglass />}
              title="Nothing approved in this period"
              description="A job counts as completed when it is approved. Widen the dates, or check the review queue above."
              className="py-8"
            />
          }
          skeleton={<ChartSkeleton bars={14} className="h-64" />}
        >
          <ChartContainer config={completedChartConfig} className="h-64 w-full">
            <BarChart
              data={completedData?.series[granularity] ?? []}
              margin={{ left: -20, right: 8 }}
            >
              <CartesianGrid vertical={false} />
              {/* Wider gap between date ticks: a 30-day range at day
                  grain was printing a label under every bar and they
                  overlapped into a grey smear. */}
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={48}
              />
              {/* Scaled to the data rather than to a fixed ceiling,
                  so one completed job does not draw an axis to four. */}
              <YAxis
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                domain={[
                  0,
                  (dataMax: number) => Math.max(1, Math.ceil(dataMax * 1.2)),
                ]}
                width={40}
              />
              <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[4, 4, 0, 0]}
                className="cursor-pointer"
                onClick={(entry: { period?: string }) =>
                  entry.period
                    ? open({ metric: "completed", value: entry.period })
                    : undefined
                }
              />
            </BarChart>
          </ChartContainer>
        </SectionShell>

        {/* FR-10.03 — developer view. */}
        <SectionShell
          title="Developer view"
          icon={<HardHat />}
          description="Units inspected, snags per unit, and what those units keep failing on."
          action={
            canExport ? (
              <ExportMenu
                onExport={exportDevelopers}
                disabled={developerRows.length === 0}
              />
            ) : null
          }
          loading={!settled(developers)}
          error={developers.error}
          onRetry={developers.reload}
          skeleton={<TableSkeleton rows={5} columns={6} />}
          // The table pads its own rows and runs edge to edge, as it did
          // before the card loaded on its own.
          bodyClassName="px-0 pb-0"
        >
          <DataTable
            data={developerPageRows}
            columns={getSnaggingDeveloperColumns({
              onViewDefects: (row) => setDefectsFor(row.developer_name),
            })}
            // A breakdown, not a list to search: the heading above
            // already says what these rows are, so no toolbar.
            onGlobalFilterChange={() => { }}
            onPageChange={setDeveloperPage}
            onPageSizeChange={(size) => {
              setDeveloperPageSize(size);
              setDeveloperPage(0);
            }}
            pageSize={developerPageSize}
            currentPage={developerPage}
            // The card shows its own skeleton while loading, so the
            // table only ever renders settled rows.
            loading={false}
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
        </SectionShell>

        {/* FR-10.04 — inspector view. */}
        <SectionShell
          title="Inspector view"
          icon={<UserRound />}
          description="Inspections carried out and how long each took. Snag count is not shown: it measures the building, not the inspector."
          action={
            canExport ? (
              <ExportMenu
                onExport={exportInspectors}
                disabled={inspectorRows.length === 0}
              />
            ) : null
          }
          loading={!settled(inspectors)}
          error={inspectors.error}
          onRetry={inspectors.reload}
          skeleton={<TableSkeleton rows={5} columns={5} />}
          bodyClassName="px-0 pb-0"
        >
          <DataTable
            data={inspectorPageRows}
            columns={getSnaggingInspectorColumns()}
            onGlobalFilterChange={() => { }}
            onPageChange={setInspectorPage}
            onPageSizeChange={(size) => {
              setInspectorPageSize(size);
              setInspectorPage(0);
            }}
            pageSize={inspectorPageSize}
            currentPage={inspectorPage}
            loading={false}
            rowCount={inspectorRows.length}
            type="snagging-analytics-inspector"
            isPagination={true}
            handleRowClick={(row) =>
              open({ metric: "inspector", value: row.user_id })
            }
            emptyState={
              <EmptyState
                icon={<UserRound />}
                title="No inspections assigned in this period"
                description="Nobody walked a unit between these dates. Widen the range to see earlier activity."
              />
            }
          />
        </SectionShell>
      </div>

      {/*
        Snags by category, moved here from the Overview.

        It counts every snag in the business, and the Overview now counts
        only the reader's own work — so on that page it was the one card
        answering a different question from all the others. Change 11
        moved the other two snag cards off for the same reason; this is
        the third, and org-wide figures are what Analytics is for.
      */}
      <SnagsByCategory />

      <DeveloperDefectsDialog
        developer={
          defectsFor === null
            ? null
            : (dialogDevelopers.find((row) => row.developer_name === defectsFor) ?? {
                ...EMPTY_DEVELOPER,
                developer_name: defectsFor,
              })
        }
        onClose={() => setDefectsFor(null)}
        onRefresh={developers.reload}
        refreshing={developers.loading}
      />

      <AnalyticsDrilldown
        request={drilldown}
        onClose={() => setDrilldown(null)}
        canExport={canExport}
      />
    </div>
  );
}

/**
 * One stat card's placeholder, shaped like the real card.
 *
 * The KPI row is two sections sharing one grid, so each card has to be
 * able to stand in on its own; a whole-row skeleton would bring its own
 * grid and knock the five columns out of line.
 */
function StatTileSkeleton() {
  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-2 px-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
      <div className="space-y-1.5 px-4">
        <Skeleton className="h-4 w-32" />
      </div>
    </Card>
  );
}

/** Label, bar, count: the rhythm of the status and queue rows. */
function BarRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 py-1">
          <Skeleton className="h-4 w-24 shrink-0" />
          <Skeleton className="h-1.5 flex-1 rounded-full" />
          <Skeleton className="h-4 w-8 shrink-0" />
        </div>
      ))}
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

/** The per-status movement, in the same badge shape as the stat cards. */
function StatusTrend({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums"
      title={`${value > 0 ? "+" : ""}${value} vs the previous period`}
    >
      <Icon className="size-3" aria-hidden />
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

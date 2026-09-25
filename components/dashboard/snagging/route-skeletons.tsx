import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FieldsSkeleton,
  HeadingSkeleton,
  ListSkeleton,
  SectionSkeleton,
  StatGridSkeleton,
} from "@/components/dashboard/shared/kaizen-states";
import {
  ChartSkeleton,
  LinesSkeleton,
  TableSkeleton,
} from "@/components/dashboard/snagging/overview/section-shell";

/*
  One placeholder per snagging screen, shaped like that screen.

  The segment had a single loading.tsx -- heading, stat cards, a section --
  and Next shows the nearest one while a route loads. Since the jobs,
  quotations, clients and job pages started reading their data on the
  server, that wait is the whole load, so every page opened on the same
  generic shape and the page's own skeleton never got to show. Each route
  now has its own loading.tsx drawing one of these, and where a component
  has a loading state of its own it draws the same one from here, so the
  route's placeholder and the component's are one and the same.
*/

/** The card a DataTable sits in: its toolbar, header row and rows. */
function TableCardSkeleton({
  filters = 1,
  columns = 5,
  rows = 8,
}: {
  filters?: number;
  columns?: number;
  rows?: number;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-full sm:w-80" />
          {Array.from({ length: filters }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-40" />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="hidden h-9 w-28 sm:block" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className="flex h-14 items-center gap-6 border-t px-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className={i === 0 ? "h-3.5 w-32" : "h-3.5 w-16"} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex h-14 items-center gap-6 border-t px-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton
              key={i}
              className={i === 0 ? "h-4 w-40" : i === columns - 1 ? "h-4 w-12" : "h-4 w-16"}
            />
          ))}
        </div>
      ))}
    </Card>
  );
}

/** A list page: heading with its button, then the table card. */
export function TablePageSkeleton({
  filters,
  columns,
  withActions = true,
}: {
  filters?: number;
  columns?: number;
  withActions?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions={withActions} />
      <TableCardSkeleton filters={filters} columns={columns} />
    </div>
  );
}

/** /snagging: the day at a glance. */
export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <StatGridSkeleton count={5} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionSkeleton>
          <ChartSkeleton bars={14} className="p-5" />
        </SectionSkeleton>
        <SectionSkeleton>
          <ChartSkeleton bars={6} className="p-5" />
        </SectionSkeleton>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionSkeleton>
          <LinesSkeleton className="p-5" />
        </SectionSkeleton>
        <SectionSkeleton>
          <LinesSkeleton className="p-5" />
        </SectionSkeleton>
      </div>
      <SectionSkeleton>
        <div className="p-5">
          <TableSkeleton rows={4} columns={4} />
        </div>
      </SectionSkeleton>
    </div>
  );
}

/** /snagging/analytics: figures, then the charts and the two tables. */
export function AnalyticsBodySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <StatGridSkeleton count={5} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionSkeleton />
        <SectionSkeleton />
      </div>
      <SectionSkeleton />
      <SectionSkeleton />
      <SectionSkeleton />
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <AnalyticsBodySkeleton />
    </div>
  );
}

/** /snagging/review: the queue beside the inspection being walked. */
export function ReviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="gap-0 self-start p-0">
          <div className="px-4 pt-4 pb-2">
            <Skeleton className="h-3 w-20" />
          </div>
          <ul className="border-t">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="space-y-2 border-b border-l-2 border-l-transparent px-4 py-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-3/4" />
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    </div>
  );
}

/** New job, new quotation, edit quotation: the wizard's card of fields. */
export function WizardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <Card className="gap-0 overflow-hidden p-0">
        <div className="space-y-4 p-4">
          <Skeleton className="h-5 w-40" />
          <FieldsSkeleton fields={6} columns={3} className="p-0" />
          <Skeleton className="h-5 w-32" />
          <FieldsSkeleton fields={4} columns={2} className="p-0" />
        </div>
        <div className="flex justify-between border-t px-6 py-4">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-28" />
        </div>
      </Card>
    </div>
  );
}

/** A quotation: the way back and its actions, then the document. */
export function QuotationBodySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-[28rem] w-full" />
    </div>
  );
}

export function QuotationDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-44" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <QuotationBodySkeleton />
    </div>
  );
}

/**
 * A job before it arrives: the tab row as the filled bar it is, and one
 * panel shaped like the snag list most jobs open on.
 */
export function JobTabsSkeleton() {
  return (
    <>
      <div className="bg-muted flex w-full items-center gap-1 rounded-lg p-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="bg-background/60 h-7 flex-1 rounded-md" />
        ))}
      </div>
      <Card className="gap-0 overflow-hidden p-0">
        <div className="space-y-2 px-5 pt-5 pb-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <div className="border-t">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 border-b px-5 py-4 last:border-b-0">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-12 w-12 rounded-md" />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/** /snagging/[id]: the back link and Refresh, then the tabs. */
export function JobDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
      <JobTabsSkeleton />
    </div>
  );
}

/**
 * The report: its toolbar, then an A4 sheet with its contents greyed --
 * masthead, two property/client cards, the visit strip, the summary
 * figures, then defect sections -- so nothing jumps when it arrives.
 */
export function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-40" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
      </div>
      <div className="bg-card mx-auto w-full max-w-[794px] space-y-5 rounded-lg border p-8">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <Skeleton className="size-12 rounded-md" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="space-y-2 text-right">
            <Skeleton className="ml-auto h-4 w-40" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
        </div>

        <div className="flex gap-3">
          {[0, 1].map((card) => (
            <div key={card} className="flex-1 space-y-2 rounded-lg border p-3">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-2.5 w-4/5" />
              <Skeleton className="h-2.5 w-2/5" />
            </div>
          ))}
        </div>

        <Skeleton className="h-7 w-full rounded-lg" />

        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((stat) => (
              <div key={stat} className="flex-1 space-y-2 rounded-lg border p-3">
                <Skeleton className="h-2.5 w-12" />
                <Skeleton className="h-5 w-8" />
              </div>
            ))}
          </div>
        </div>

        {[0, 1].map((section) => (
          <div key={section} className="space-y-2.5">
            <Skeleton className="h-3 w-32" />
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-start gap-3">
                <Skeleton className="size-12 shrink-0 rounded-md" />
                <div className="flex-1 space-y-1.5 pt-1">
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-2.5 w-3/5" />
                </div>
                <Skeleton className="h-4 w-16 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** /snagging/[id]/desnag: the snags to carry beside the round's summary. */
export function DesnagBodySkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <SectionSkeleton>
        <ListSkeleton rows={6} />
      </SectionSkeleton>
      <SectionSkeleton className="self-start">
        <ListSkeleton rows={3} />
      </SectionSkeleton>
    </div>
  );
}

export function DesnagSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton />
      <DesnagBodySkeleton />
    </div>
  );
}

/** A return visit: its header card, figures, tabs and snag list. */
export function VisitBodySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export function VisitSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-5 w-36" />
      <VisitBodySkeleton />
    </div>
  );
}

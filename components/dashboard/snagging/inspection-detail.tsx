"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, RefreshCw, SearchX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";

import { ErrorState } from "./shared";

import { InspectorAssignmentAlert } from "./inspector-alert";
import { InspectionHeaderCard } from "./inspection-header-card";
import { JobDetailProvider, useJobDetail } from "./job-detail-context";
import { SnagWalkList } from "./snag-walk-list";
import { VisitActivityAlerts } from "./visit-activity-alerts";

/*
  The tabs the page does not open on are split into their own chunks and
  loaded when first opened. The Snags tab -- where nearly every job opens --
  ships with the page.
*/
const PanelLoading = () => <PanelSkeleton />;
const FloorPlansAreasPanel = dynamic(
  () => import("./floor-plans-areas-panel").then((m) => m.FloorPlansAreasPanel),
  { loading: PanelLoading },
);
const ChecklistPanel = dynamic(
  () => import("./checklist-panel").then((m) => m.ChecklistPanel),
  { loading: PanelLoading },
);
const JobSetupPanel = dynamic(
  () => import("./job-setup-panel").then((m) => m.JobSetupPanel),
  { loading: PanelLoading },
);
const QuotationPanel = dynamic(
  () => import("./quotation-panel").then((m) => m.QuotationPanel),
  { loading: PanelLoading },
);
const AdditionalVisitsPanel = dynamic(
  () => import("./additional-visits-panel").then((m) => m.AdditionalVisitsPanel),
  { loading: PanelLoading },
);
const AuditTimeline = dynamic(
  () => import("./audit-timeline").then((m) => m.AuditTimeline),
  { loading: PanelLoading },
);

/**
 * Which tab a job opens on.
 *
 * A draft or newly assigned job is opened to be set up — the snag list
 * is empty and the appointment is not booked. Once work has started the
 * snags are the reason anyone opens the record, so it leads from there
 * onwards.
 */
function defaultTabFor(status: string | undefined): string {
  if (status === "draft" || status === "assigned") return "setup";
  return "snags";
}

/**
 * A single inspection, opened from the jobs table or a dashboard link.
 *
 * Its data lives in JobDetailProvider, above the tabs, so it is fetched
 * once and shared: see job-detail-context.tsx for which data each tab
 * reads and what a change refreshes. Keyed by the job, so another job
 * starts clean.
 */
export default function InspectionDetail({ taskId }: { taskId: string }) {
  return (
    <JobDetailProvider key={taskId} taskId={taskId}>
      <InspectionDetailView />
    </JobDetailProvider>
  );
}

function InspectionDetailView() {
  const router = useRouter();
  const params = useSearchParams();
  const {
    taskId,
    job,
    checklist,
    snags,
    floorPlans,
    visitStatus,
    desnag,
    visits,
    quotation,
    audit,
    ensureQuotation,
    jobChanged,
    areasChanged,
    visitsChanged,
    quotationChanged,
    refreshJob,
    refreshChecklist,
    refreshSnags,
    refreshAll,
    refreshing,
  } = useJobDetail();

  /*
    The job record the tabs read, put together from its sections as they
    arrive. The core job is the page; the rest fill in. A section still
    loading reads as empty here, so every place that shows one of them
    checks its own slice (below) and shows a placeholder instead of a
    misleading zero.
  */
  const task = useMemo(
    () =>
      job.data
        ? {
            ...job.data,
            checklist: checklist.data ?? [],
            snags: snags.data ?? [],
            floor_plans: floorPlans.data ?? [],
            unapproved_visit_ids: visitStatus.data?.unapproved_visit_ids ?? [],
            desnag_quotation: desnag.data ?? null,
          }
        : null,
    [job.data, checklist.data, snags.data, floorPlans.data, visitStatus.data, desnag.data],
  );
  // The snag list needs its plans (for pins) and the checklist (for its
  // summary line) as well as the snags themselves.
  const snagListReady = snags.data !== null && floorPlans.data !== null && checklist.data !== null;

  // The tab lives in the URL so a link can point at one, and a refresh
  // keeps the reviewer where they were.
  const [tab, setTabState] = useState<string | null>(params.get("tab"));
  /*
    Tabs opened so far. Each stays mounted once opened -- hidden, not
    unmounted -- so going back to it shows it exactly as it was, with no
    request. Unmounting on every switch is what made each return to a tab
    fetch its data again.
  */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const setTab = useCallback((next: string) => {
    setTabState(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    const query = new URLSearchParams(window.location.search);
    query.set("tab", next);
    window.history.replaceState(null, "", `?${query.toString()}`);
  }, []);
  const activeTab = tab ?? defaultTabFor(task?.status);
  const mounted = useMemo(() => new Set([...opened, activeTab]), [opened, activeTab]);

  /*
    Name this page in the breadcrumb. The trail is built from the URL, so
    without this the last crumb was the job's UUID title-cased into
    "4d5510Bf 4f50 4948 B5e7 …" — the one place on screen that should say
    which unit you are looking at, saying nothing at all.
  */
  useBreadcrumbLabel(taskId, task ? (task.property?.unit_label ?? task.code) : undefined);

  const visitList = useMemo(() => visits.data?.visits ?? [], [visits.data]);
  /* Visit number by id, for the "Visit 2" label on the snags it raised. */
  const visitNumbers = useMemo(
    () => Object.fromEntries(visitList.map((visit) => [visit.id, visit.visit_number] as const)),
    [visitList],
  );
  /* A live visit waiting on somebody here puts a count on its tab. */
  const visitsNeedingAction = useMemo(
    () =>
      visitList.filter(
        (visit) =>
          visit.status === "submitted" ||
          visit.status === "requested" ||
          (visit.status === "scheduled" && !visit.inspector_id),
      ).length,
    [visitList],
  );
  const auditRefreshing = Object.values(audit).some((slice) => slice.refreshing);

  async function refreshEverything() {
    const ok = await refreshAll();
    if (ok) toast.success("Up to date");
    else toast.error("Some sections could not refresh. What was on screen is kept.");
  }

  /*
    The header row renders straight away, before any data: the way back,
    and the Refresh control. It never waits on the job.
  */
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <BackToJobs />
      <div className="flex items-center gap-3">
        {job.lastFetchedAt ? (
          <span className="text-muted-foreground hidden text-xs sm:inline">
            Updated {formatClock(job.lastFetchedAt)}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshEverything()}
          disabled={job.loading || refreshing}
          aria-label="Refresh this job"
        >
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>
    </div>
  );

  // The job has not arrived yet: the shape of the page, not a spinner.
  if (!task && job.loading) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        {visitList.length > 0 ? <VisitActivityAlerts taskId={taskId} visits={visitList} /> : null}
        <TabsSkeleton />
      </div>
    );
  }

  if (!task && job.error) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <ErrorState
          title="Could not load this inspection"
          message={job.error}
          onRetry={() => void refreshJob()}
          retrying={job.loading}
        />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col gap-4">
        <BackToJobs />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This inspection could not be found"
            description="It may have been cancelled, or the link may be out of date."
            action={{
              label: "Back to jobs",
              onClick: () => router.push("/snagging/jobs"),
              variant: "outline",
            }}
          />
        </Card>
      </div>
    );
  }

  /*
    Additional visits belong to the ORIGINAL inspection. Showing the
    section on a round or on a visit itself would invite raising one
    against a child, which is the chained-family shape the routes now
    deliberately refuse.
  */
  const isOriginal = !task.parent_task_id;

  /* A tab's body, mounted on first open and kept after. */
  const panel = (value: string, className: string, children: ReactNode) =>
    mounted.has(value) ? (
      <TabsContent value={value} forceMount className={`${className} data-[state=inactive]:hidden`}>
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {toolbar}

      {/*
        Above the tabs, so it is read whichever tab the job opens on: a
        visit waiting for review is the most urgent thing on the page.
        Drawn from the visits alone, so it appears as soon as they do.
      */}
      <VisitActivityAlerts taskId={task.id} visits={visitList} />

      <Tabs value={activeTab} onValueChange={setTab}>
        {/* Wraps onto a second line on a narrow screen rather than
            hiding tabs behind a sideways scroll. */}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          {/*
            A tab carries its own count where one is already loaded, and a
            small spinner while the data behind it is being re-read.
          */}
          <TabsTrigger value="snags">
            Snags
            <TabCount value={snags.data?.length} />
            <TabBusy on={job.refreshing || snags.refreshing} />
          </TabsTrigger>
          <TabsTrigger value="areas">
            Areas &amp; plan
            <TabCount value={task.areas?.length} />
            <TabBusy on={job.refreshing || floorPlans.refreshing} />
          </TabsTrigger>
          <TabsTrigger value="checklist">
            Checklist
            <TabCount value={checklist.data?.length} />
            <TabBusy on={checklist.refreshing} />
          </TabsTrigger>
          <TabsTrigger value="setup">
            Setup
            <TabBusy on={job.refreshing} />
          </TabsTrigger>
          <TabsTrigger value="quotation">
            Quotation
            <TabBusy on={quotation.refreshing} />
          </TabsTrigger>
          {/* FR-9.01 — its own section, so a chargeable return trip is
              never mistaken for a de-snag round. Only on the original
              inspection: visits hang off it, not off each other. */}
          {isOriginal ? (
            <TabsTrigger value="visits">
              Additional visits
              {visitsNeedingAction > 0 ? (
                <Badge className="bg-warning ml-1.5 px-1.5 font-normal tabular-nums text-white">
                  {visitsNeedingAction}
                </Badge>
              ) : null}
              <TabBusy on={visits.refreshing} />
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="history">
            History
            <TabBusy on={auditRefreshing} />
          </TabsTrigger>
        </TabsList>

        {panel(
          "snags",
          "mt-4 flex flex-col gap-6",
          <>
            {/*
              The gap is worth saying here as well as on Setup: this is the
              tab the job opens on, so an unassigned job would otherwise read
              as ready until somebody went looking for the inspector.
            */}
            <InspectorAssignmentAlert
              task={task}
              onAssign={() => {
                setTab("setup");
                // After the tab has painted; the field does not exist until
                // the panel is mounted.
                window.setTimeout(() => {
                  document
                    .getElementById("inspector-assignment")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 120);
              }}
            />
            {/* The counts and the Approve / Send back decision sit with
                the snags they are about. */}
            <InspectionHeaderCard
              task={task}
              onChanged={jobChanged}
              onVisitsChanged={visitsChanged}
              pending={{ snags: snags.data === null, desnag: desnag.lastFetchedAt === null }}
            />
            {snagListReady ? (
              <SnagWalkList task={task} visitNumbers={visitNumbers} />
            ) : snags.error && snags.data === null ? (
              <ErrorState
                title="Could not load the snags"
                message={snags.error}
                onRetry={() => void refreshSnags()}
                retrying={snags.loading}
              />
            ) : (
              <PanelSkeleton />
            )}
          </>,
        )}
        {panel(
          "areas",
          "mt-4",
          <FloorPlansAreasPanel
            taskId={task.id}
            propertyType={task.property?.property_type}
            bedrooms={task.property?.bedrooms}
            onChanged={areasChanged}
          />,
        )}
        {panel(
          "checklist",
          "mt-4",
          checklist.data !== null ? (
            <ChecklistPanel task={task} />
          ) : checklist.error ? (
            <ErrorState
              title="Could not load the checklist"
              message={checklist.error}
              onRetry={() => void refreshChecklist()}
              retrying={checklist.loading}
            />
          ) : (
            <PanelSkeleton />
          ),
        )}
        {panel("setup", "mt-4", <JobSetupPanel task={task} onChanged={jobChanged} />)}
        {panel(
          "quotation",
          "mt-4",
          /* The inspection's own quotation only. A visit's quotation is on
             that visit's page. */
          <QuotationTab
            task={task}
            ensure={ensureQuotation}
            source={{
              quote: quotation.data,
              // Not fetched yet counts as loading: the tab asks on mount. An
              // answer of "none" has a timestamp, so it never spins forever.
              loading: quotation.loading || (quotation.lastFetchedAt === null && !quotation.error),
              error: quotation.data ? null : quotation.error,
              reload: quotationChanged,
            }}
          />,
        )}
        {isOriginal ? panel("visits", "mt-4", <AdditionalVisitsPanel task={task} />) : null}
        {panel("history", "mt-4", <AuditTimeline />)}
      </Tabs>
    </div>
  );
}

/** The Quotation tab: asks the page for the quotation the first time it opens. */
function QuotationTab({
  task,
  ensure,
  source,
}: {
  task: NonNullable<ReturnType<typeof useJobDetail>["job"]["data"]>;
  ensure: () => void;
  source: {
    quote: ReturnType<typeof useJobDetail>["quotation"]["data"];
    loading: boolean;
    error: string | null;
    reload: () => void;
  };
}) {
  useEffect(() => {
    ensure();
  }, [ensure]);
  return <QuotationPanel task={task} onChanged={source.reload} source={source} />;
}

/** One back link, so every state on this screen keeps a way out. */
function BackToJobs() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href="/snagging/jobs">
        <ArrowLeft className="size-4" />
        Jobs
      </Link>
    </Button>
  );
}

/** "14:32", in Gulf time, for the "Updated" note beside Refresh. */
function formatClock(at: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  }).format(new Date(at));
}

/**
 * The count beside a tab label, absent rather than zero when empty.
 *
 * A Badge rather than a hand-styled span, so every tab's count picks up
 * the same radius, padding and type scale as every other count in the
 * app — and changes with it.
 */
function TabCount({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <Badge variant="secondary" className="ml-1.5 px-1.5 font-normal tabular-nums">
      {value}
    </Badge>
  );
}

/** A small spinner on a tab whose data is being re-read; the data stays. */
function TabBusy({ on }: { on: boolean }) {
  if (!on) return null;
  return <Loader2 className="text-muted-foreground ml-1 size-3 animate-spin" aria-label="Refreshing" />;
}

/** A tab body loading its code for the first time. */
function PanelSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="space-y-2 px-5 pt-5 pb-4">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <div className="space-y-3 border-t p-5">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-24 w-full" />
      </div>
    </Card>
  );
}

/**
 * The page before the job arrives: the tab row as the filled bar it is,
 * and one panel shaped like the snag list most jobs open on.
 */
function TabsSkeleton() {
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

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingTask } from "@/types/types";

import { ErrorState } from "./shared";

import { AuditTimeline } from "./audit-timeline";
import { ChecklistPanel } from "./checklist-panel";
import { FloorPlansAreasPanel } from "./floor-plans-areas-panel";
import { JobSetupPanel } from "./job-setup-panel";
import { InspectorAssignmentAlert } from "./inspector-alert";
import { AdditionalVisitsPanel } from "./additional-visits-panel";
import { QuotationPanel } from "./quotation-panel";
import { InspectionHeaderCard } from "./inspection-header-card";
import { SnagWalkList } from "./snag-walk-list";

/**
 * A single inspection, opened from the jobs table or a dashboard link.
 *
 * It reuses the review panel so the record reads the same whether a
 * manager reached it from the queue or an ops lead reached it from the
 * list. The only difference here is the back link to the jobs table.
 */
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

export default function InspectionDetail({ taskId }: { taskId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [task, setTask] = useState<SnaggingTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The tab lives in the URL so a link can point at one, and a refresh
  // keeps the reviewer where they were.
  const [tab, setTabState] = useState<string | null>(params.get("tab"));
  const setTab = useCallback((next: string) => {
    setTabState(next);
    const query = new URLSearchParams(window.location.search);
    query.set("tab", next);
    window.history.replaceState(null, "", `?${query.toString()}`);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTask(await snaggingService.getTask(taskId));
    } catch (err) {
      // A failed request and a genuinely missing inspection used to look
      // identical ("could not be found"), which sent people hunting for
      // a record that was there all along. They are separate states now.
      setTask(null);
      setError(
        err instanceof Error ? err.message : "Could not load the inspection",
      );
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Name this page in the breadcrumb. The trail is built from the URL, so
    without this the last crumb was the job's UUID title-cased into
    "4d5510Bf 4f50 4948 B5e7 …" — the one place on screen that should say
    which unit you are looking at, saying nothing at all.
  */
  useBreadcrumbLabel(
    taskId,
    task ? (task.property?.unit_label ?? task.code) : undefined,
  );

  /*
    Additional visits belong to the ORIGINAL inspection. Showing the
    section on a round or on a visit itself would invite raising one
    against a child, which is the chained-family shape the routes now
    deliberately refuse.
  */
  const isOriginal = !task?.parent_task_id;

  if (loading) {
    return (
      // Back link, then the tab row, then ONE panel -- the page shows a
      // single tab at a time. The tab row is drawn as the filled bar it
      // actually is, with six evenly spaced pills inside it: loose pills
      // floating on the page meant the real bar appeared underneath them
      // and shoved the panel down.
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-24" />

        <div className="bg-muted flex w-full items-center gap-1 rounded-lg p-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="bg-background/60 h-7 flex-1 rounded-md"
            />
          ))}
        </div>

        {/*
          Shaped like the panel the page opens on: a card header, then a
          list of rows each with its marker, two lines and a trailing badge.
        */}
        <Card className="gap-0 overflow-hidden p-0">
          <div className="space-y-2 px-5 pt-5 pb-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3.5 w-64" />
          </div>
          <div className="border-t">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-3 border-b px-5 py-4 last:border-b-0"
              >
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
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <BackToJobs />
        <ErrorState
          title="Could not load this inspection"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
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

  return (
    <div className="flex flex-col gap-4">
      <BackToJobs />

      {/*
        One panel at a time. Stacked, the six panels mounted together and
        fired around twenty requests before the page settled; a tab only
        pays for what is on screen. The choice is in the URL so a link
        can point at a specific one.
      */}
      <Tabs value={tab ?? defaultTabFor(task.status)} onValueChange={setTab}>
        {/* Wraps onto a second line on a narrow screen rather than
            hiding tabs behind a sideways scroll. */}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          {/*
            A tab carries its own count where one is already loaded, so
            the row says how much is behind each panel before you open it.
            Quotation and History fetch on demand, so they stay bare
            rather than showing a number that could be wrong.
          */}
          <TabsTrigger value="snags">
            Snags
            <TabCount value={task.snags?.length} />
          </TabsTrigger>
          <TabsTrigger value="areas">
            Areas &amp; plan
            <TabCount value={task.areas?.length} />
          </TabsTrigger>
          <TabsTrigger value="checklist">
            Checklist
            <TabCount value={task.checklist?.length} />
          </TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="quotation">Quotation</TabsTrigger>
          {/* FR-9.01 — its own section, so a chargeable return trip is
              never mistaken for a de-snag round. Only on the original
              inspection: visits hang off it, not off each other. */}
          {isOriginal ? (
            <TabsTrigger value="visits">Additional visits</TabsTrigger>
          ) : null}
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="snags" className="mt-4 flex flex-col gap-6">
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
              the snags they are about, rather than pinned above every
              tab where they were repeating information the other tabs
              do not need. */}
          <InspectionHeaderCard task={task} onChanged={() => void load()} />
          <SnagWalkList task={task} />
        </TabsContent>
        <TabsContent value="areas" className="mt-4">
          <FloorPlansAreasPanel
            taskId={task.id}
            propertyType={task.property?.property_type}
            bedrooms={task.property?.bedrooms}
          />
        </TabsContent>
        <TabsContent value="checklist" className="mt-4">
          <ChecklistPanel task={task} />
        </TabsContent>
        <TabsContent value="setup" className="mt-4">
          <JobSetupPanel task={task} onChanged={() => void load()} />
        </TabsContent>
        <TabsContent value="quotation" className="mt-4">
          <QuotationPanel task={task} onChanged={() => void load()} />
        </TabsContent>
        {isOriginal ? (
          <TabsContent value="visits" className="mt-4">
            <AdditionalVisitsPanel task={task} onChanged={() => void load()} />
          </TabsContent>
        ) : null}
        <TabsContent value="history" className="mt-4">
          <AuditTimeline taskId={task.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
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
    <Badge
      variant="secondary"
      className="ml-1.5 px-1.5 font-normal tabular-nums"
    >
      {value}
    </Badge>
  );
}

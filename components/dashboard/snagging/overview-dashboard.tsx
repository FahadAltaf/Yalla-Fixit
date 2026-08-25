"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Inbox, Plus, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingOverview } from "@/types/types";

import { EmptyState } from "@/components/ui/empty-state";

import {
  DataState,
  FieldsSkeleton,
  ListSkeleton,
  PageHeading,
  SEVERITY_LABELS,
  SectionCard,
  SectionSkeleton,
  StatCard,
  StatGridSkeleton,
  SubmitButton,
  timeAgo,
} from "./shared";

/**
 * Today at a glance.
 *
 * The screen answers three questions in the order an ops lead asks
 * them: what is in flight, what is waiting on me, and what is the
 * portfolio doing. Everything below the fold is context; everything
 * above it is a decision.
 */
export default function SnaggingOverviewDashboard() {
  const router = useRouter();
  const { userProfile } = useAuth();
  const [data, setData] = useState<SnaggingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const canCreate = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await snaggingService.getOverview());
    } catch (err) {
      // Kept on the page rather than toasted: a failed overview used to
      // leave the day looking like zero jobs in flight.
      setError(err instanceof Error ? err.message : "Could not load the overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setSyncing(true);
    await load();
    setSyncing(false);
  }

  const inFlight = data
    ? data.counts.assigned + data.counts.inProgress + data.counts.submitted
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Property care"
        title="Today at a glance"
        description={
          data
            ? `${inFlight} job${inFlight === 1 ? "" : "s"} in flight. ${
                data.counts.submitted
              } inspection${data.counts.submitted === 1 ? " is" : "s are"} waiting on you.`
            : loading
              ? "Loading the day."
              : "Every inspection in flight, and what is waiting on you."
        }
        actions={
          <>
            <SubmitButton
              variant="outline"
              onClick={() => void refresh()}
              pending={syncing}
              pendingLabel="Pulling…"
              icon={<RefreshCw className="size-4" />}
            >
              Pull changes
            </SubmitButton>
            {canCreate ? (
              <Button onClick={() => router.push("/snagging/jobs/new")}>
                <Plus className="size-4" />
                New job
              </Button>
            ) : null}
          </>
        }
      />

      <DataState
        loading={loading}
        error={error}
        // Retrying through refresh() so the spinner lands on the button
        // that is already the page's "try the server again" control.
        onRetry={() => void refresh()}
        retrying={syncing}
        errorTitle="Could not load the overview"
        skeleton={
          // The whole page has a shape while it loads, not just the KPI
          // row: the sections below used to pop in after it.
          <div className="flex flex-col gap-6">
            <StatGridSkeleton count={5} className="lg:grid-cols-5" />
            <div className="grid gap-6 lg:grid-cols-2">
              <SectionSkeleton />
              <SectionSkeleton>
                <ListSkeleton rows={3} />
              </SectionSkeleton>
            </div>
            <SectionSkeleton>
              <FieldsSkeleton fields={3} columns={3} />
            </SectionSkeleton>
          </div>
        }
      >
        {data ? (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard
                label="Assigned"
                value={data.counts.assigned}
                caption="pack not pulled"
                tone="neutral"
                href="/snagging/jobs?status=assigned"
              />
              <StatCard
                label="In progress"
                value={data.counts.inProgress}
                caption="capture underway"
                tone="progress"
                href="/snagging/jobs?status=in_progress"
              />
              <StatCard
                label="Submitted"
                value={data.counts.submitted}
                caption="waiting on review"
                tone="review"
                href="/snagging/review"
              />
              <StatCard
                label="Approved"
                value={data.counts.approved}
                caption="report ready"
                tone="good"
                href="/snagging/jobs?status=approved"
              />
              <StatCard
                label="Needs correction"
                value={data.counts.needsCorrection}
                caption="reopened on device"
                tone="bad"
                href="/snagging/jobs?status=rejected"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard
                title="Waiting on review"
                action={
                  <Button asChild variant="link" className="text-brand h-auto p-0">
                    <Link href="/snagging/review">Open queue</Link>
                  </Button>
                }
                bodyClassName="border-t"
              >
                {data.waitingOnReview.length === 0 ? (
                  <EmptyState
                    icon={<Inbox className="size-6" />}
                    title="Nothing waiting"
                    description="Every submitted inspection has been actioned. New submissions land here."
                  />
                ) : (
                  <ul>
                    {data.waitingOnReview.map((task) => (
                      <li key={task.id} className="border-b last:border-b-0">
                        <Link
                          href={`/snagging/${task.id}`}
                          className="hover:bg-mist-soft flex flex-wrap items-center gap-3 px-5 py-4 transition-colors"
                        >
                          <span className="text-muted-foreground font-mono text-xs">
                            {task.code}
                          </span>
                          <span className="min-w-40 flex-1">
                            <span className="block font-medium">{task.unit_label}</span>
                            <span className="text-muted-foreground block text-xs">
                              {[task.building_name, task.client_name].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          {task.high_severity_count > 0 ? (
                            <Badge
                              variant="secondary"
                              className="bg-danger/10 text-danger border-0"
                            >
                              {task.high_severity_count} high
                            </Badge>
                          ) : null}
                          <span className="text-muted-foreground text-xs whitespace-nowrap">
                            {timeAgo(task.submitted_at)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard
                title="Snags by severity"
                description={`Open snags across the portfolio. ${data.openSnagTotal} of ${data.snagTotal} recorded.`}
                bodyClassName="px-5 pb-5"
              >
                <div className="space-y-4">
                  {data.severity.map((row) => {
                    const share = data.openSnagTotal
                      ? Math.round((row.count / data.openSnagTotal) * 100)
                      : 0;
                    const bar =
                      row.severity === "high"
                        ? "bg-danger"
                        : row.severity === "medium"
                          ? "bg-warning"
                          : "bg-ink/25";
                    const dot = bar;

                    return (
                      <div key={row.severity}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span className={`size-2 rounded-full ${dot}`} aria-hidden />
                            {SEVERITY_LABELS[row.severity]} severity
                          </span>
                          <span className="font-medium tabular-nums">{row.count}</span>
                        </div>
                        <div className="bg-mist mt-2 h-1.5 w-full overflow-hidden rounded-full">
                          <div
                            className={`h-full rounded-full ${bar}`}
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-5">
                  <div>
                    <p className="eyebrow">De-snag rounds</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {data.roundsOutstanding}
                    </p>
                    <p className="text-muted-foreground text-xs">outstanding</p>
                  </div>
                  <div>
                    <p className="eyebrow">Pass rate</p>
                    <p className="text-success mt-1 text-2xl font-semibold tabular-nums">
                      {data.passRate === null ? "—" : `${data.passRate}%`}
                    </p>
                    <p className="text-muted-foreground text-xs">verified closed, last 30d</p>
                  </div>
                </div>
              </SectionCard>
            </div>

            {/* The system allows one near-black band per page. It is spent
                here, on the thing most likely to be misread: a submitted
                inspection is not the same as a complete one. */}
            <Card className="kz-band-dark border-0 p-6">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="max-w-xl">
                  <p className="eyebrow text-brand-200">Still in flight</p>
                  <h2 className="mt-2 text-2xl text-white">
                    {data.sync.stuckInError === 0
                      ? "Every change the field sent has landed"
                      : `${data.sync.stuckInError} change${
                          data.sync.stuckInError === 1 ? "" : "s"
                        } the server refused`}
                  </h2>
                  <p className="mt-2 text-sm text-white/70">
                    A submitted inspection is not the same as a complete one. Media can trail the
                    snag record, so a job can arrive as metadata first and pick up its photos after.
                  </p>
                </div>

                <div className="flex items-center gap-8">
                  <div>
                    <p className="text-2xl font-semibold text-white tabular-nums">
                      {data.sync.photosReceived}
                    </p>
                    <p className="text-xs text-white/60">files received</p>
                  </div>
                  <div>
                    <p
                      className={`text-2xl font-semibold tabular-nums ${
                        data.sync.stuckInError > 0 ? "text-brand-200" : "text-white"
                      }`}
                    >
                      {data.sync.stuckInError}
                    </p>
                    <p className="text-xs text-white/60">stuck in error</p>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    className="border-0 bg-white text-ink hover:bg-white/90"
                  >
                    <Link href="/snagging/analytics">
                      Sync health
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        ) : null}
      </DataState>
    </div>
  );
}

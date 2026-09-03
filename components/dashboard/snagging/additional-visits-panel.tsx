"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, FileText, Plus, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { cn } from "@/lib/utils";
import type { SnaggingTask } from "@/types/types";

import { ErrorState, SectionSkeleton, FieldsSkeleton } from "./shared";
import { AdditionalVisitDialog } from "./additional-visit-dialog";
import { ScheduleVisitDialog } from "./schedule-visit-dialog";

/**
 * FR-9.01 / FR-9.05 — the additional visits raised against an inspection.
 *
 * Kept deliberately distinct from de-snagging. A round re-checks defects
 * that already exist; a visit goes back for rooms and elements the first
 * pass could not cover, and anything it finds joins THIS inspection's
 * report rather than becoming a report of its own. Mixing them on one
 * screen is what makes people treat a chargeable return trip as a free
 * re-inspection.
 */
type VisitRow = {
  id: string;
  code: string;
  status: string;
  visit_number: number;
  scheduled_date: string | null;
  appointment_at: string | null;
  visit_charge: number | null;
  inspector: { id?: string; full_name?: string; email?: string } | null;
  quotation: {
    id: string;
    status: string;
    total: number | null;
    quote_number: string | null;
  } | null;
  new_snags: number;
  report_version: number | null;
};

type VersionRow = {
  id: string;
  version: number;
  source_visit_id: string | null;
  snag_count: number;
  generated_at: string;
  reason: string | null;
};

const QUOTE_TONE: Record<string, string> = {
  approved: "bg-success/10 text-success",
  sent: "bg-warning/10 text-warning",
  draft: "bg-mist text-ink-soft",
  rejected: "bg-danger/10 text-danger",
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}

export function AdditionalVisitsPanel({
  task,
  onChanged,
}: {
  task: SnaggingTask;
  onChanged: () => void;
}) {
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [scheduling, setScheduling] = useState<VisitRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/snagging/tasks/${task.id}/visits`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not load the additional visits");
      setVisits(body.data?.visits ?? []);
      setVersions(body.data?.versions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the additional visits");
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <SectionSkeleton>
        <FieldsSkeleton fields={4} columns={2} />
      </SectionSkeleton>
    );
  }

  if (error) {
    return <ErrorState title="Could not load the additional visits" message={error} onRetry={() => void load()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Additional visits"
        icon={<CalendarClock />}
        description="Chargeable return trips for rooms and elements the inspection could not cover. Anything found joins this inspection's report."
        bodyClassName="border-t"
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create additional visit
          </Button>
        }
      >
        {visits.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title="No additional visits"
            description="Raise one when an area or element could not be inspected and the client agrees to a return trip."
          />
        ) : (
          <ul className="divide-y">
            {visits.map((visit) => (
              <li key={visit.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Visit #{visit.visit_number}</span>
                    <span className="text-muted-foreground font-mono text-xs">{visit.code}</span>
                    <Badge variant="secondary" className="border-0 font-medium">
                      {visit.status}
                    </Badge>
                  </div>

                  <dl className="text-muted-foreground mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div className="flex items-center gap-1.5">
                      <FileText className="size-3.5 shrink-0" aria-hidden />
                      <dt className="sr-only">Quotation</dt>
                      <dd>
                        {visit.quotation ? (
                          <>
                            <span className="font-mono text-xs">
                              {visit.quotation.quote_number ?? "Quotation"}
                            </span>{" "}
                            <Badge
                              variant="secondary"
                              className={cn(
                                "border-0 font-medium",
                                QUOTE_TONE[visit.quotation.status] ?? "bg-mist text-ink-soft",
                              )}
                            >
                              {visit.quotation.status}
                            </Badge>
                          </>
                        ) : (
                          // FR-9.04: this is why the visit cannot be booked.
                          <span className="text-warning">No quotation yet</span>
                        )}
                      </dd>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
                      <dt className="sr-only">Appointment</dt>
                      <dd>{fmtDate(visit.appointment_at ?? visit.scheduled_date)}</dd>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <UserRound className="size-3.5 shrink-0" aria-hidden />
                      <dt className="sr-only">Inspector</dt>
                      <dd>{visit.inspector?.full_name ?? "Not assigned"}</dd>
                    </div>

                    <div>
                      <dt className="sr-only">New snags</dt>
                      <dd>
                        {visit.new_snags > 0
                          ? `${visit.new_snags} new snag${visit.new_snags === 1 ? "" : "s"}`
                          : "No new snags yet"}
                        {visit.report_version ? ` · report V${visit.report_version}` : ""}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/*
                  Only a draft is bookable here. Once assigned the visit
                  belongs to the inspector's flow, and a delivered one is
                  history — offering "schedule" on either would be a
                  button that only ever returns a refusal.
                */}
                {visit.status === "draft" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScheduling(visit)}
                    className="shrink-0"
                  >
                    <CalendarClock className="size-4" />
                    Schedule
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/*
        The report's history, so it is visible that a visit reissues the
        client's ONE report rather than producing a second one. Hidden
        until versions exist, which is also the honest state on an
        environment where the versions migration has not been applied.
      */}
      {versions.length > 0 ? (
        <SectionCard
          title="Report versions"
          icon={<FileText />}
          description="The client holds one report. Each additional visit reissues it; earlier versions stay available."
          bodyClassName="border-t"
        >
          <ul className="divide-y">
            {versions.map((version, index) => (
              <li key={version.id} className="flex flex-wrap items-baseline gap-3 px-5 py-3">
                <span className="font-medium">V{version.version}</span>
                {index === 0 ? (
                  <Badge variant="secondary" className="bg-success/10 text-success border-0">
                    Current
                  </Badge>
                ) : null}
                <span className="text-muted-foreground text-sm">
                  {version.snag_count} snag{version.snag_count === 1 ? "" : "s"} ·{" "}
                  {fmtDate(version.generated_at)}
                </span>
                {version.reason ? (
                  <span className="text-muted-foreground/80 text-sm">{version.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <ScheduleVisitDialog
        taskId={task.id}
        visit={scheduling}
        open={scheduling !== null}
        onOpenChange={(next) => {
          if (!next) setScheduling(null);
        }}
        onScheduled={() => {
          void load();
          onChanged();
        }}
      />

      <AdditionalVisitDialog
        taskId={task.id}
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          // Closing after a create: pick up the new visit and let the
          // page refresh its own counts.
          if (!next) {
            void load();
            onChanged();
          }
        }}
      />
    </div>
  );
}

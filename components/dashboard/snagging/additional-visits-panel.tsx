"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  CalendarClock,
  CreditCard,
  FileText,
  Plus,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingJobVisit, SnaggingTask } from "@/types/types";

import { ErrorState, SectionSkeleton, FieldsSkeleton } from "./shared";
import { AdditionalVisitDialog } from "./additional-visit-dialog";

/**
 * The additional visits on this job (BA v2, changes 25-30).
 *
 * A visit is an APPOINTMENT on this job, not a job of its own: it uses
 * the job's areas and checklist, and what it finds joins this
 * inspection's report. That is change 25, and it is why this panel lists
 * rows rather than linking away to other inspections.
 *
 * Kept deliberately distinct from de-snagging, which IS a separate job
 * (change 31): a de-snag re-checks defects that already exist, a visit
 * goes back for what the first pass could not cover. Mixing them is what
 * makes people treat a chargeable return trip as a free re-inspection.
 */
type VisitRow = SnaggingJobVisit;

type VersionRow = {
  id: string;
  version: number;
  source_visit_id: string | null;
  snag_count: number;
  generated_at: string;
  reason: string | null;
};

/*
  Requested is amber because it is waiting on somebody; scheduled and
  completed are settled states. Cancelled is muted rather than red — a
  called-off trip is not a failure, it is a fact about the record.
*/
const VISIT_TONE: Record<string, string> = {
  requested: "bg-warning/10 text-warning",
  scheduled: "bg-brand/10 text-brand",
  in_progress: "bg-brand/10 text-brand",
  completed: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft",
};

const VISIT_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "On site",
  completed: "Completed",
  cancelled: "Cancelled",
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

  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await snaggingService.listVisits(task.id);
      setVisits(body.visits ?? []);
      setVersions((body.versions ?? []) as VersionRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the additional visits");
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  /**
   * Books the visit.
   *
   * The server decides whether it may be: a quotation-charged visit waits
   * for the client to approve one (FR-9.04), a link-charged visit does
   * not (change 26). The refusal comes back as a sentence, so this does
   * not try to guess the rule a second time on the client.
   */
  async function book(visit: VisitRow) {
    setBusy(visit.id);
    try {
      await snaggingService.updateVisit(task.id, visit.id, { status: "scheduled" });
      toast.success(`Visit ${visit.visit_number} booked`);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not book the visit");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(visit: VisitRow) {
    setBusy(visit.id);
    try {
      await snaggingService.cancelVisit(task.id, visit.id);
      toast.success(`Visit ${visit.visit_number} cancelled`);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the visit");
    } finally {
      setBusy(null);
    }
  }

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
        description="Chargeable return trips on this job. Every area stays available, and anything found joins this inspection's report."
        bodyClassName="border-t"
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Add visit
          </Button>
        }
      >
        {visits.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title="No additional visits"
            description="Add one when an area could not be inspected and the client is paying for a return trip — by quotation or by payment link."
          />
        ) : (
          <ul className="divide-y">
            {visits.map((visit) => (
              <li key={visit.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Visit {visit.visit_number}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border-0 font-medium",
                        VISIT_TONE[visit.status] ?? "bg-mist text-ink-soft",
                      )}
                    >
                      {VISIT_LABEL[visit.status] ?? visit.status}
                    </Badge>
                    {visit.charge ? (
                      <span className="text-muted-foreground text-sm tabular-nums">
                        AED {visit.charge.toLocaleString()} + VAT
                      </span>
                    ) : null}
                  </div>

                  <dl className="text-muted-foreground mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {/*
                      Change 26 — how it is being paid for, said plainly.
                      "No quotation yet" used to read as a problem on every
                      visit; on a link-charged one it is not a problem, it
                      is the point.
                    */}
                    <div className="flex items-center gap-1.5">
                      {visit.charge_method === "payment_link" ? (
                        <CreditCard className="size-3.5 shrink-0" aria-hidden />
                      ) : (
                        <FileText className="size-3.5 shrink-0" aria-hidden />
                      )}
                      <dt className="sr-only">Charged by</dt>
                      <dd>
                        {visit.charge_method === "payment_link" ? (
                          <>
                            Payment link
                            {visit.payment_reference ? (
                              <span className="font-mono text-xs">
                                {" "}
                                · {visit.payment_reference}
                              </span>
                            ) : null}
                          </>
                        ) : visit.quotation ? (
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
                          // Only a blocker on the quotation route (FR-9.04).
                          <span className="text-warning">Quotation not raised yet</span>
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
                      <dt className="sr-only">Snags found</dt>
                      <dd>
                        {(visit.snag_count ?? 0) > 0
                          ? `${visit.snag_count} snag${visit.snag_count === 1 ? "" : "s"} on this job`
                          : "No snags from this visit yet"}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/*
                  Only a requested visit is bookable. Once booked it
                  belongs to the inspector's day, and a completed or
                  cancelled one is history — offering "book" on either
                  would be a button that only ever returns a refusal.
                */}
                <div className="flex shrink-0 items-center gap-2">
                  {visit.status === "requested" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === visit.id}
                        onClick={() => void book(visit)}
                      >
                        <CalendarClock className="size-4" />
                        Book
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === visit.id}
                        onClick={() => void cancel(visit)}
                        aria-label={`Cancel visit ${visit.visit_number}`}
                        title="Cancel this visit"
                      >
                        <Ban className="size-4" />
                      </Button>
                    </>
                  ) : visit.status === "scheduled" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === visit.id}
                      onClick={() => void cancel(visit)}
                      aria-label={`Cancel visit ${visit.visit_number}`}
                      title="Cancel this visit"
                    >
                      <Ban className="size-4" />
                    </Button>
                  ) : null}
                </div>
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

      <AdditionalVisitDialog
        taskId={task.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void load();
          onChanged();
        }}
      />
    </div>
  );
}

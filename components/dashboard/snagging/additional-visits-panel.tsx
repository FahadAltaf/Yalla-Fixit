"use client";

import { Money } from "@/components/ui/money";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Ban,
  ClipboardCheck,
  CalendarClock,
  CreditCard,
  ExternalLink,
  FilePlus2,
  FileText,
  MoreHorizontal,
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { IdentityCell } from "@/components/ui/entity-avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type SnaggingJobVisit,
  type SnaggingTask,
} from "@/types/types";

import {
  ErrorState,
  SectionSkeleton,
  FieldsSkeleton,
  SubmitButton,
  formatLocalDateTime,
  useConfirm,
} from "./shared";
import { AdditionalVisitDialog } from "./additional-visit-dialog";
import { useJobDetail } from "./job-detail-context";
import { VisitEditDialog } from "./visit-edit-dialog";

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
  generation_status?: string | null;
  generation_error?: string | null;
};

/*
  A render takes seconds. A version still unfinished after this long was
  cut off (a restart, or background work after an approval that never
  ran), so it is offered for retry. The server applies the same limit.
*/
const STUCK_AFTER_MS = 10 * 60 * 1000;

/** Where a version's PDF stands. A row from before the column is ready. */
function pdfState(version: VersionRow): "ready" | "working" | "stuck" | "failed" {
  const status = version.generation_status ?? "generated";
  if (status === "generated") return "ready";
  if (status === "failed") return "failed";
  const age = Date.now() - new Date(version.generated_at).getTime();
  return age > STUCK_AFTER_MS ? "stuck" : "working";
}

const PDF_STATE: Record<ReturnType<typeof pdfState>, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "bg-success/10 text-success" },
  working: { label: "Generating", tone: "bg-brand/10 text-brand" },
  stuck: { label: "Did not finish", tone: "bg-warning/10 text-warning" },
  failed: { label: "Failed", tone: "bg-destructive/10 text-destructive" },
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
  submitted: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft",
};

const VISIT_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "On site",
  submitted: "Awaiting review",
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
  }).format(new Date(value));
}

export function AdditionalVisitsPanel({ task }: { task: SnaggingTask }) {
  /*
    The visits are the page's (JobDetailContext), not this tab's.

    This tab used to fetch its own copy on every open, alongside the one
    the page already held for the alerts and the snag labels -- two lists
    that disagreed after any change until both were re-read. Now there is
    one, and a change here re-reads it through `visitsChanged`, which also
    refreshes the job and History for every other tab.
  */
  const { visits: visitsSlice, visitsChanged, refreshVisits } = useJobDetail();
  const visits = (visitsSlice.data?.visits ?? []) as VisitRow[];
  const versions = (visitsSlice.data?.versions ?? []) as VersionRow[];
  /* Who is on the job now: what a new visit opens on. */
  const jobRosterIds = useMemo(
    () =>
      (task.assignees ?? [])
        .map((assignee) => assignee.user_id)
        .filter((id): id is string => Boolean(id)),
    [task.assignees],
  );
  const jobRosterNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const assignee of task.assignees ?? []) {
      const who = assignee.user_profile;
      if (assignee.user_id && who) {
        names[assignee.user_id] = (who.full_name || who.email) ?? assignee.user_id;
      }
    }
    return names;
  }, [task.assignees]);

  const rendering = versions.some((v) => pdfState(v) === "working");

  /*
    An approval renders the PDF in the background, so a version can arrive
    here still generating. Checked again every few seconds (each refresh
    re-arms this) until it is done, failed, or has run long enough to count
    as stuck.
  */
  useEffect(() => {
    if (!rendering) return;
    const timer = window.setTimeout(() => void refreshVisits(), 5000);
    return () => window.clearTimeout(timer);
  }, [rendering, visitsSlice.data, refreshVisits]);
  const loading = visitsSlice.loading;
  // A failed refresh keeps the list on screen; only a first load fails here.
  const error = visitsSlice.data ? null : visitsSlice.error;
  const [createOpen, setCreateOpen] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  /* The report version whose PDF is being rendered again. */
  const [retrying, setRetrying] = useState<string | null>(null);
  const { userProfile } = useAuth();
  // The server's gate on report versions: approve permission, or an admin.
  const canRetryReport =
    hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.APPROVE) ||
    isAdminUser(userProfile);
  const router = useRouter();
  const { confirm, dialog } = useConfirm();

  /* The visit whose inspector, date and notes are being edited. */
  const [editing, setEditing] = useState<VisitRow | null>(null);
  /* True when the dialog is booking the visit by assigning it. */
  const [bookMode, setBookMode] = useState(false);
  const openVisit = (visit: VisitRow) => router.push(`/snagging/${task.id}/visits/${visit.id}`);

  /* The visit whose charge method is being switched, and its reference. */
  const [switching, setSwitching] = useState<VisitRow | null>(null);
  const [paymentRef, setPaymentRef] = useState("");

  const load = useCallback(async () => {
    await refreshVisits();
  }, [refreshVisits]);

  /**
   * Raises the visit's quotation from this job and links it (change 26).
   *
   * Lands on the quotation itself, because the next thing that happens
   * to it is sending it to the client — and Send, Share on WhatsApp and
   * the PDF all live on that page already.
   */
  async function raiseQuotation(visit: VisitRow) {
    setBusy(visit.id);
    const id = toast.loading(`Raising the quotation for visit ${visit.visit_number}…`);
    try {
      const quote = await snaggingService.raiseVisitQuotation(task.id, visit.id);
      toast.success(`Quotation ${quote.quote_number} raised`, {
        id,
        description: "Send it to the client. Book the visit once they approve.",
      });
      router.push(`/snagging/${task.id}/visits/${visit.id}?tab=quotation`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not raise the quotation", { id });
      setBusy(null);
    }
  }

  function openSwitch(visit: VisitRow) {
    setPaymentRef(visit.payment_reference ?? "");
    setSwitching(visit);
  }

  /**
   * Moves a visit between the two ways it can be paid for (change 26).
   *
   * Asked for the change it actually is: switching to a payment link
   * lets go of any quotation already raised, and saying so first is what
   * stops a coordinator stranding one the client is halfway through
   * reading.
   */
  async function switchCharge() {
    const visit = switching;
    if (!visit) return;
    const next = visit.charge_method === "payment_link" ? "quotation" : "payment_link";

    if (next === "payment_link" && visit.quotation && visit.quotation.status !== "rejected") {
      const ok = await confirm({
        title: `Stop charging visit ${visit.visit_number} by quotation?`,
        description: `Quotation ${visit.quotation.quote_number ?? ""} is ${visit.quotation.status}. It will no longer be linked to this visit, and the visit can be booked as soon as the payment link is paid.`,
        confirmText: "Switch to payment link",
      });
      if (!ok) return;
    }

    setBusy(visit.id);
    try {
      await snaggingService.updateVisit(task.id, visit.id, {
        charge_method: next,
        payment_reference: next === "payment_link" ? paymentRef.trim() || null : null,
      });
      toast.success(
        next === "payment_link"
          ? `Visit ${visit.visit_number} is now charged by payment link`
          : `Visit ${visit.visit_number} is now charged by quotation`,
      );
      setSwitching(null);
      await visitsChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change how the visit is charged");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(visit: VisitRow) {
    const ok = await confirm({
      title: `Cancel visit ${visit.visit_number}?`,
      description:
        "The visit is called off. Anything it has already found stays on the job.",
      confirmText: "Cancel visit",
      cancelText: "Keep visit",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(visit.id);
    try {
      await snaggingService.cancelVisit(task.id, visit.id);
      await visitsChanged();
      toast.success(`Visit ${visit.visit_number} cancelled`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the visit");
    } finally {
      setBusy(null);
    }
  }

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

  /*
    The row's next step, and only that one: raise the quotation, send it,
    book, assign, review -- following the visit through its route. A
    payment link goes straight to Book (change 26). Everything occasional
    sits in the row's menu.
  */
  const nextAction = (visit: VisitRow) => (
    <>
            {visit.status === "requested"
              ? (() => {
                const quote = visit.quotation;
                const byQuote = visit.charge_method !== "payment_link";
                const needsQuote =
                  byQuote && (!quote || quote.status === "rejected");
                const awaitingClient =
                  byQuote && quote && (quote.status === "draft" || quote.status === "sent");

                // Opening the visit's Quotation tab raises it, as the
                // job's does; a rejected one is raised again here,
                // on purpose.
                if (needsQuote && quote?.status !== "rejected") {
                  return (
                    <Button
                      size="sm"
                      onClick={() =>
                        router.push(`/snagging/${task.id}/visits/${visit.id}?tab=quotation`)
                      }
                    >
                      <FilePlus2 className="size-4" />
                      Raise quotation
                    </Button>
                  );
                }
                if (needsQuote) {
                  return (
                    <SubmitButton
                      size="sm"
                      pending={busy === visit.id}
                      pendingLabel="Raising…"
                      icon={<FilePlus2 className="size-4" />}
                      onClick={() => void raiseQuotation(visit)}
                    >
                      {quote?.status === "rejected" ? "Raise new quotation" : "Raise quotation"}
                    </SubmitButton>
                  );
                }
                if (awaitingClient) {
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        router.push(`/snagging/${task.id}/visits/${visit.id}?tab=quotation`)
                      }
                    >
                      <FileText className="size-4" />
                      {quote!.status === "draft" ? "Send quotation" : "View quotation"}
                    </Button>
                  );
                }
                /*
                  Paid for -- quotation approved, or charged by link. What
                  is left is who goes and when, and assigning them books
                  it; the server still checks the quotation (FR-9.04).
                */
                return (
                  <Button
                    size="sm"
                    onClick={() => {
                      setBookMode(true);
                      setEditing(visit);
                    }}
                  >
                    <UserRound className="size-4" />
                    Assign inspector
                  </Button>
                );
              })()
              : visit.status === "scheduled" && !visit.inspector_id ? (
                /*
                  Booked, but nobody is going. The phone of the
                  inspector who should be has nothing on it until
                  this is set, so it is the next step.
                */
                <Button size="sm" onClick={() => setEditing(visit)}>
                  <UserRound className="size-4" />
                  Assign inspector
                </Button>
              ) : visit.status === "submitted" ? (
                <Button size="sm" onClick={() => openVisit(visit)}>
                  <ClipboardCheck className="size-4" />
                  Review
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => openVisit(visit)}>
                  <ExternalLink className="size-4" />
                  Open visit
                </Button>
              )}
    </>
  );

  const rowMenu = (visit: VisitRow) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={busy === visit.id}
              aria-label={`Actions for visit ${visit.visit_number}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max">
            <DropdownMenuItem onClick={() => openVisit(visit)}>
              <ExternalLink className="size-4" />
              Open visit
            </DropdownMenuItem>
            {visit.status !== "completed" && visit.status !== "cancelled" ? (
              <DropdownMenuItem onClick={() => setEditing(visit)}>
                <Pencil className="size-4" />
                Edit inspector, date and notes
              </DropdownMenuItem>
            ) : null}
            {visit.quotation ? (
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/snagging/${task.id}/visits/${visit.id}?tab=quotation`)
                }
              >
                <FileText className="size-4" />
                Open quotation
              </DropdownMenuItem>
            ) : null}
            {visit.status === "requested" ? (
              <DropdownMenuItem onClick={() => openSwitch(visit)}>
                <ArrowLeftRight className="size-4" />
                {visit.charge_method === "payment_link"
                  ? "Charge by quotation instead"
                  : "Charge by payment link instead"}
              </DropdownMenuItem>
            ) : null}
            {visit.status === "requested" || visit.status === "scheduled" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void cancel(visit)}
                >
                  <Ban className="size-4" />
                  Cancel visit
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
  );

  // Newest first: the visit being worked is the one looked for.
  const newestFirst = [...visits].sort((a, b) => b.visit_number - a.visit_number);
  const versionsNewestFirst = [...versions].sort((a, b) => b.version - a.version);
  // The one in force is the newest whose PDF exists, not simply the newest.
  const currentVersionId = versionsNewestFirst.find((v) => pdfState(v) === "ready")?.id;

  async function retryVersion(version: VersionRow) {
    setRetrying(version.id);
    const id = toast.loading(`Generating the V${version.version} PDF…`);
    try {
      await snaggingService.retryReportVersion(task.id, version.id);
      await refreshVisits();
      toast.success(`V${version.version} PDF generated`, { id });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "The PDF could not be generated",
        { id },
      );
      await refreshVisits();
    } finally {
      setRetrying(null);
    }
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10 ps-5">Visit</TableHead>
                  <TableHead className="h-10">Status</TableHead>
                  <TableHead className="h-10">Charge</TableHead>
                  <TableHead className="h-10">Appointment</TableHead>
                  <TableHead className="h-10">Inspector</TableHead>
                  <TableHead className="h-10 text-right">Snags</TableHead>
                  <TableHead className="h-10 pe-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newestFirst.map((visit) => {
                  const quote = visit.quotation;
                  const when = visit.appointment_at
                    ? formatLocalDateTime(visit.appointment_at)
                    : visit.scheduled_date
                      ? fmtDate(visit.scheduled_date)
                      : null;
                  return (
                    <TableRow key={visit.id}>
                      <TableCell className="ps-5">
                        <button
                          type="button"
                          className="group flex flex-col items-start text-left"
                          onClick={() => openVisit(visit)}
                        >
                          <span className="font-medium underline-offset-2 group-hover:underline">
                            Visit {visit.visit_number}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            Raised {fmtDate(visit.created_at)}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "rounded-sm border-none font-medium",
                            VISIT_TONE[visit.status] ?? "bg-mist text-ink-soft",
                          )}
                        >
                          {VISIT_LABEL[visit.status] ?? visit.status}
                        </Badge>
                      </TableCell>
                      {/*
                        Change 26 -- the amount, and how it is being paid
                        for under it: the quotation and where it stands, or
                        the payment link. "No quotation yet" is only a
                        blocker on the quotation route.
                      */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="whitespace-nowrap tabular-nums">
                            {visit.charge ? (
                              <>
                                <Money value={visit.charge} dp={0} /> + VAT
                              </>
                            ) : (
                              "—"
                            )}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1.5 text-xs whitespace-nowrap">
                            {visit.charge_method === "payment_link" ? (
                              <>
                                <CreditCard className="size-3.5 shrink-0" aria-hidden />
                                Payment link
                                {visit.payment_reference ? (
                                  <span className="font-mono">· {visit.payment_reference}</span>
                                ) : null}
                              </>
                            ) : quote ? (
                              <>
                                <FileText className="size-3.5 shrink-0" aria-hidden />
                                <button
                                  type="button"
                                  className="text-foreground font-mono underline-offset-2 hover:underline"
                                  onClick={() =>
                                    router.push(`/snagging/${task.id}/visits/${visit.id}?tab=quotation`)
                                  }
                                >
                                  {quote.quote_number ?? "Quotation"}
                                </button>
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "h-4 rounded-sm border-none px-1.5 text-[11px] font-medium capitalize",
                                    QUOTE_TONE[quote.status] ?? "bg-mist text-ink-soft",
                                  )}
                                >
                                  {quote.status}
                                </Badge>
                              </>
                            ) : (
                              <>
                                <FileText className="size-3.5 shrink-0" aria-hidden />
                                <span className="text-warning">Quotation not raised</span>
                              </>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {when ? (
                          <span className="flex items-center gap-1.5">
                            <CalendarClock className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                            {when}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not booked</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {visit.inspector ? (
                          <IdentityCell
                            title={visit.inspector.full_name ?? visit.inspector.email ?? "Inspector"}
                            /*
                              Who else is going, rather than the first
                              inspector's email: a visit is attended by a
                              set now, and the row named only one of them.
                            */
                            subtitle={
                              (visit.inspectors?.length ?? 0) > 1
                                ? `with ${(visit.inspectors ?? [])
                                    .slice(1)
                                    .map((person) => person.full_name ?? person.email)
                                    .filter(Boolean)
                                    .join(", ")}`
                                : visit.inspector.full_name
                                  ? visit.inspector.email
                                  : null
                            }
                            seed={visit.inspector.id}
                          />
                        ) : (
                          <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap">
                            <UserRound className="size-3.5 shrink-0" aria-hidden />
                            Not assigned
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {visit.snag_count ?? 0}
                      </TableCell>
                      <TableCell className="pe-5">
                        <div className="flex items-center justify-end gap-2">
                          {nextAction(visit)}
                          {rowMenu(visit)}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10 ps-5">Version</TableHead>
                  <TableHead className="h-10">Issued for</TableHead>
                  <TableHead className="h-10 text-right">Snags</TableHead>
                  <TableHead className="h-10">PDF</TableHead>
                  <TableHead className="h-10 pe-5 text-right">Issued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versionsNewestFirst.map((version) => {
                  const state = pdfState(version);
                  return (
                  <TableRow key={version.id}>
                    <TableCell className="ps-5">
                      <span className="flex items-center gap-2 font-medium">
                        V{version.version}
                        {version.id === currentVersionId ? (
                          <Badge
                            variant="secondary"
                            className="bg-success/10 text-success rounded-sm border-none font-medium"
                          >
                            Current
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {version.reason ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{version.snag_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={cn("gap-1 rounded-sm border-none font-medium", PDF_STATE[state].tone)}
                        >
                          {state === "working" ? <Loader2 className="size-3 animate-spin" /> : null}
                          {PDF_STATE[state].label}
                        </Badge>
                        {(state === "failed" || state === "stuck") && canRetryReport ? (
                          <SubmitButton
                            size="sm"
                            variant="outline"
                            className="h-7"
                            pending={retrying === version.id}
                            pendingLabel="Retrying…"
                            disabled={retrying !== null}
                            icon={<RotateCw className="size-3.5" />}
                            onClick={() => void retryVersion(version)}
                          >
                            Retry
                          </SubmitButton>
                        ) : null}
                      </div>
                      {state === "failed" && version.generation_error ? (
                        <p className="text-muted-foreground mt-1 max-w-xs text-xs">
                          {version.generation_error}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground pe-5 text-right whitespace-nowrap">
                      {fmtDate(version.generated_at)}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      ) : null}

      <Dialog
        open={Boolean(switching)}
        onOpenChange={(open) => {
          if (!open) setSwitching(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {switching?.charge_method === "payment_link"
                ? "Charge by quotation"
                : "Charge by payment link"}
            </DialogTitle>
            <DialogDescription>
              {switching?.charge_method === "payment_link"
                ? "Raise a quotation from this job for the client to approve. The visit can be booked once they do."
                : "No quotation needed. Send the client a payment link and book the visit as soon as it is paid."}
            </DialogDescription>
          </DialogHeader>

          {switching?.charge_method !== "payment_link" ? (
            <div className="space-y-1.5">
              <Label htmlFor="switch-payment-ref">Payment reference</Label>
              <Input
                id="switch-payment-ref"
                value={paymentRef}
                onChange={(event) => setPaymentRef(event.target.value)}
                placeholder="Optional — the link or transaction id"
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSwitching(null)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <SubmitButton
              pending={busy !== null && busy === switching?.id}
              pendingLabel="Saving…"
              onClick={() => void switchCharge()}
            >
              Switch
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog}

      <VisitEditDialog
        taskId={task.id}
        visit={editing}
        open={Boolean(editing)}
        book={bookMode}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setBookMode(false);
          }
        }}
        onSaved={visitsChanged}
      />

      <AdditionalVisitDialog
        taskId={task.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultInspectorIds={jobRosterIds}
        inspectorNames={jobRosterNames}
        onCreated={visitsChanged}
      />
    </div>
  );
}

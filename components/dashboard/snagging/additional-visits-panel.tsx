"use client";

import { Money } from "@/components/ui/money";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Ban,
  Bug,
  Clock,
  CalendarCheck,
  ClipboardCheck,
  CalendarClock,
  CreditCard,
  ExternalLink,
  FilePlus2,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";
import type { SnaggingJobVisit, SnaggingTask } from "@/types/types";

import {
  ErrorState,
  SectionSkeleton,
  FieldsSkeleton,
  SubmitButton,
  formatLocalDateTime,
  timeAgo,
  useConfirm,
  ActionDialogContent,
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
  /*
    Raising a chargeable return trip is a create, and the API has always
    said so. The button did not: it was offered to everybody who could
    open this tab, so an inspector filled the whole dialog in -- reason,
    date, who is going, how it is charged -- pressed Add visit and got
    the word "Forbidden". The permission is checked where the button is
    now, so the dialog is never opened by somebody it cannot help.
  */
  const { userProfile } = useAuth();
  const canCreate = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.CREATE,
  );
  const visits = (visitsSlice.data?.visits ?? []) as VisitRow[];
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

  const loading = visitsSlice.loading;
  // A failed refresh keeps the list on screen; only a first load fails here.
  const error = visitsSlice.data ? null : visitsSlice.error;
  const [createOpen, setCreateOpen] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
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

    const switched =
      next === "payment_link"
        ? `Visit ${visit.visit_number} is now charged by payment link`
        : `Visit ${visit.visit_number} is now charged by quotation`;
    const run = async () => {
      setBusy(visit.id);
      try {
        await snaggingService.updateVisit(task.id, visit.id, {
          charge_method: next,
          payment_reference: next === "payment_link" ? paymentRef.trim() || null : null,
        });
        setSwitching(null);
        await visitsChanged();
      } finally {
        setBusy(null);
      }
    };

    // Dropping a live quotation is asked about, and the dialog then makes
    // the change itself, staying open until the panel shows it.
    if (next === "payment_link" && visit.quotation && visit.quotation.status !== "rejected") {
      const ok = await confirm({
        title: `Stop charging visit ${visit.visit_number} by quotation?`,
        description: `Quotation ${visit.quotation.quote_number ?? ""} is ${visit.quotation.status}. It will no longer be linked to this visit, and the visit can be booked as soon as the payment link is paid.`,
        confirmText: "Switch to payment link",
        action: run,
      });
      if (ok) toast.success(switched);
      return;
    }

    try {
      await run();
      toast.success(switched);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change how the visit is charged");
    }
  }

  async function cancel(visit: VisitRow) {
    /*
      The dialog does the cancelling and stays open until it is done, so
      the answer to "did that work?" is on the dialog that asked. It used
      to close on Confirm and leave the row to change moments later, with
      a failure arriving as a toast over a page that looked untouched.
    */
    const done = await confirm({
      title: `Cancel visit ${visit.visit_number}?`,
      description:
        "The visit is called off. Anything it has already found stays on the job.",
      confirmText: "Cancel visit",
      cancelText: "Keep visit",
      variant: "destructive",
      action: async () => {
        setBusy(visit.id);
        try {
          await snaggingService.cancelVisit(task.id, visit.id);
          await visitsChanged();
        } finally {
          setBusy(null);
        }
      },
    });
    if (done) toast.success(`Visit ${visit.visit_number} cancelled`);
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
                // Named for what is left: a visit that already names
                // somebody is waiting on the booking, not the assignment.
                const assigned = Boolean(visit.inspectors?.length || visit.inspector_id);
                return (
                  <Button
                    size="sm"
                    onClick={() => {
                      setBookMode(true);
                      setEditing(visit);
                    }}
                  >
                    {assigned ? (
                      <CalendarCheck className="size-4" />
                    ) : (
                      <UserRound className="size-4" />
                    )}
                    {assigned ? "Book visit" : "Assign inspector"}
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

  /* The columns, in the shape every house table takes (column-snagging-job). */
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  const visitColumns: ColumnDef<VisitRow>[] = [
    {
      id: "visit",
      header: "Visit",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-36">
          <IdentityCell
            title={`Visit ${row.original.visit_number}`}
            subtitle={`Raised ${fmtDate(row.original.created_at)}`}
            icon={CalendarClock}
          />
        </div>
      ),
    },
    {
      /*
        As the Jobs table shows it: the first inspector and a count, with
        everyone on hover. A visit can take any number of inspectors, and
        listing them all made one row taller than the rest.
      */
      id: "inspector",
      header: "Inspector",
      enableSorting: false,
      cell: ({ row }) => {
        const visit = row.original;
        const names = (visit.inspectors?.length ? visit.inspectors : visit.inspector ? [visit.inspector] : [])
          .map((person) => person.full_name ?? person.email)
          .filter((name): name is string => Boolean(name));
        if (names.length === 0) {
          return (
            <IconText icon={UserRound} muted>
              Unassigned
            </IconText>
          );
        }
        const extra = names.length - 1;
        const cell = (
          <IconText icon={UserRound}>
            <span className="truncate">{names[0]}</span>
            {extra > 0 ? <span className="text-muted-foreground shrink-0"> +{extra}</span> : null}
          </IconText>
        );
        // No tooltip when there is nothing it could add.
        if (extra === 0) return cell;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block min-w-0 cursor-default">{cell}</span>
            </TooltipTrigger>
            <TooltipContent>
              {names.map((name) => (
                <p key={name}>{name}</p>
              ))}
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={cn(
            "rounded-sm border-none font-medium",
            VISIT_TONE[row.original.status] ?? "bg-mist text-ink-soft",
          )}
        >
          {VISIT_LABEL[row.original.status] ?? row.original.status}
        </Badge>
      ),
    },
    {
      /*
        Change 26 -- the amount, and how it is being paid for under it: the
        quotation and where it stands, or the payment link.
      */
      id: "charge",
      header: "Charge",
      enableSorting: false,
      cell: ({ row }) => {
        const visit = row.original;
        const quote = visit.quotation;
        return (
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
                    onClick={(event) => {
                      stop(event);
                      router.push(`/snagging/${task.id}/visits/${visit.id}?tab=quotation`);
                    }}
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
        );
      },
    },
    {
      id: "appointment",
      header: "Appointment",
      enableSorting: false,
      cell: ({ row }) => {
        const visit = row.original;
        const when = visit.appointment_at
          ? formatLocalDateTime(visit.appointment_at)
          : visit.scheduled_date
            ? fmtDate(visit.scheduled_date)
            : null;
        return when ? (
          <IconText icon={CalendarCheck}>{when}</IconText>
        ) : (
          <IconText icon={CalendarCheck} muted>
            Not booked
          </IconText>
        );
      },
    },
    {
      id: "snags",
      header: "Snags",
      enableSorting: false,
      cell: ({ row }) => (
        <IconText icon={Bug} muted={!row.original.snag_count}>
          <span className="tabular-nums">{row.original.snag_count ?? 0}</span>
        </IconText>
      ),
    },
    {
      id: "updated_at",
      header: "Updated",
      enableSorting: false,
      cell: ({ row }) => (
        <IconText icon={Clock} muted>
          {timeAgo(row.original.updated_at)}
        </IconText>
      ),
    },
    {
      id: "actions",
      header: () => "Actions",
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        // The row opens the visit; its buttons do their own thing.
        <div className="flex items-center justify-end gap-2" onClick={stop}>
          {nextAction(row.original)}
          {rowMenu(row.original)}
        </div>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Additional visits"
        icon={<CalendarClock />}
        description="Chargeable return trips on this job. Every area stays available, and anything found joins this inspection's report."
        bodyClassName="border-t"
        action={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Add visit
            </Button>
          ) : null
        }
      >
        {/*
          The house table (the shared DataTable the Jobs and Quotations
          lists use), not a table of its own: the same header row, row
          hover, empty state and footer as every other list.
        */}
        <DataTable
          columns={visitColumns}
          data={newestFirst}
          loading={false}
          rowCount={newestFirst.length}
          pageSize={Math.max(newestFirst.length, 1)}
          currentPage={0}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          onGlobalFilterChange={() => undefined}
          handleRowClick={(visit) => openVisit(visit)}
          emptyState={
            <EmptyState
              className="border-0"
              icon={<CalendarClock className="size-6" />}
              title="No additional visits"
              description={
                canCreate
                  ? "Add one when an area could not be inspected and the client is paying for a return trip, by quotation or by payment link."
                  : "A return trip is raised by whoever books the work. None has been on this job."
              }
            />
          }
        />
      </SectionCard>

      <Dialog
        open={Boolean(switching)}
        onOpenChange={(open) => {
          if (!open) setSwitching(null);
        }}
      >
        <ActionDialogContent busy={busy !== null} className="sm:max-w-md">
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
                placeholder="Optional. The link or transaction id"
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
        </ActionDialogContent>
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

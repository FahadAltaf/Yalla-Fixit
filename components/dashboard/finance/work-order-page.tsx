"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileText,
  FileUp,
  History,
  Info,
  ListChecks,
  Loader2,
  MessageSquareReply,
  Paperclip,
  PauseCircle,
  Pencil,
  Percent,
  PlayCircle,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  Upload,
  UserMinus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { YallaClassicTemplate } from "@/components/dashboard/extensions/quotation-templates/templates/YallaClassicTemplate";
import { DataRow, ListPager, SectionCard, StatCard, StatCardGrid, TabCount, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { refreshAll, useSection } from "@/components/dashboard/snagging/overview/use-section";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fsmRecordLink } from "@/lib/fsm-links";
import { INVOICE_STATUS_LABELS, QUEUE_STATUS_LABELS, invoiceTotals, withVat } from "@/lib/finance/line-status";
import {
  COMPLETION_LABELS,
  PROGRESS_PURPOSE_LABELS,
  isCancelledOrClosed,
  isEnded,
  isNonBillable,
  isVoid,
  lineCompletion,
  workOrderCompletion,
  type ProgressPurpose,
} from "@/lib/finance/progress";
import type { LiveAttachment, LiveServiceReport } from "@/lib/server/finance/fsm-live";
import { formatZonedDate, formatZonedDateTime, todayInZone } from "@/lib/scheduling/org-time";
import type { FsmCompletionResult } from "@/lib/server/finance/fsm-completion";
import type { QueryList, QuerySide } from "@/lib/server/finance/queries";
import type { WorkOrderAbilities } from "@/lib/server/finance/route-helpers";
import type { WorkOrderDetail, WorkOrderEvent, WorkOrderEventType, WorkOrderInvoice, WorkOrderLine } from "@/lib/server/finance/work-orders";
import { cn } from "@/lib/utils";
import { financeService } from "@/modules/finance/finance-service";

import { EvidenceLinks, ExclusionDialog, uploadEvidenceFiles } from "./exclusion-dialog";
import { QueryThreadView, RaiseQueryDialog, type QueryPeople } from "./query-thread";
import { InvoiceStatusBadge, InvoiceTotals, LineName, WorkOrderQueueBadge, WorkOrderStatusBadge, aed, daysSince } from "./shared";
import { UploadInvoiceDialog } from "./upload-invoice-dialog";

/**
 * One work order in Ready to invoice (laid out like the inspection
 * detail), read live from Zoho FSM: the header card with its status, what
 * it waits on and the actions the person may take; four figures; then
 * tabs for its line items, invoices, history and quotation.
 *
 * Invoicing by line (22, 23 and 26 Oct): a work order Completed in FSM with
 * its quotation flagged To Be Invoiced is invoiced in full or in part;
 * before that, as far as Operations has recorded it done to invoice
 * (Record % done). The MAHER invoice is uploaded or entered with its PDF;
 * anything not invoiceable says why in a dialog. The Reports tab shows the
 * files FSM holds on the work order and its appointments (service
 * reports). An invoice moves the work order to In Progress by itself. The
 * workflow (BRD 5.1 Step 4): hold, resume; queries as a thread between
 * Finance and Operations (2 Nov, the Queries tab); Operations marks a work
 * order not to be invoiced, with evidence. A one-click change (resume) asks
 * first; one made in a dialog does not ask again. Stored in the portal; FSM
 * is only read.
 *
 * Cached in the browser and on the server for ten minutes, so going back
 * and opening it again costs no FSM call; Refresh reads it again.
 */

/* Finance: invoice; Operations: % done, ready; both: queries, hold, not invoiceable and back (route-helpers, 2 Nov). */
type Can = WorkOrderAbilities;
type Detail = WorkOrderDetail & { can: Can };
type Action = "put_on_hold" | "resume";
type Queries = QueryList & { sides: QuerySide[]; tagOptions: QueryPeople };
type NoteAsk = {
  action: Action | "mark_invoiceable";
  title: string;
  description: string;
  label: string;
  submit: string;
  /** The note may be left empty. */
  optional?: boolean;
};

const DETAIL_STALE_MS = 10 * 60_000;
/* After a change the page shows it is updating at least this long, so the change is seen even when the new read is quick. */
const SETTLE_MS = 700;
const at = (iso: string | null) => (iso ? formatZonedDateTime(iso) : "—");

/* Each change's wording and icon, as the job page's history has them (audit-timeline.tsx). */
const EVENT_META: Record<WorkOrderEventType, { label: string; Icon: LucideIcon }> = {
  marked_ready: { label: "Marked ready to invoice", Icon: CheckCheck },
  unmarked_ready: { label: "Ready mark taken off", Icon: Undo2 },
  invoiced: { label: "Invoiced", Icon: ReceiptText },
  picked_up: { label: "Moved to In progress", Icon: PlayCircle },
  released: { label: "Released", Icon: UserMinus },
  query_raised: { label: "Query raised", Icon: CircleHelp },
  query_answered: { label: "Query answered", Icon: MessageSquareReply },
  put_on_hold: { label: "Put on hold", Icon: PauseCircle },
  resumed: { label: "Resumed", Icon: PlayCircle },
  exclusion_requested: { label: "Marked not to be invoiced", Icon: ShieldAlert },
  exclusion_verified: { label: "Marked not invoiceable", Icon: ShieldCheck },
  exclusion_rejected: { label: "Exclusion rejected", Icon: XCircle },
  exclusion_reverted: { label: "Marked invoiceable again", Icon: Undo2 },
  progress_recorded: { label: "Progress recorded", Icon: Percent },
  fsm_completed: { label: "Completed in Zoho FSM", Icon: CheckCheck },
  fsm_not_completed: { label: "Not completed in Zoho FSM", Icon: TriangleAlert },
};

/* 2 Nov: what Zoho FSM said to a completion; the portal's is saved whatever it says. */
function toastFsm(fsm: FsmCompletionResult | null | undefined) {
  if (!fsm) return;
  if (fsm.state === "done") toast.success(fsm.message);
  else if (fsm.state === "partial" || fsm.state === "refused") toast.warning(fsm.message, { duration: 12_000 });
  else toast.message(fsm.message);
}

const formatWhen = (value: string) =>
  new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function FinanceWorkOrderPage({ id }: { id: string }) {
  const url = `/api/finance/work-orders/${encodeURIComponent(id)}`;
  const { data, loading, error, reload } = useSection<Detail>(url, { staleMs: DETAIL_STALE_MS });
  /* 2 Nov: this work order's queries, every one, with the people each side may tag. */
  const queries = useSection<Queries>(`/api/finance/queries?view=all&workOrder=${encodeURIComponent(id)}&pageSize=100`, { staleMs: 60_000 });
  const [raising, setRaising] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceLines, setInvoiceLines] = useState<WorkOrderLine[] | null>(null);
  /* The upload, limited to the lines ticked (null: every completed line). */
  const [upload, setUpload] = useState<{ only: string[] | null } | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; description: string } | null>(null);
  /* Partially complete (30 Oct): the lines it is opened for (one from the table, or every line not complete). */
  const [partialFor, setPartialFor] = useState<{ lines: WorkOrderLine[] } | null>(null);
  /* Complete a line (30 Oct): only asked to invoice or revenue only; its % is 100. */
  const [completeFor, setCompleteFor] = useState<{ line: WorkOrderLine } | null>(null);
  const [exclusionOpen, setExclusionOpen] = useState(false);
  const [noteAsk, setNoteAsk] = useState<NoteAsk | null>(null);
  const [note, setNote] = useState("");
  const [formSession, setFormSession] = useState(0);
  const { confirm, dialog } = useConfirm();
  /*
    From a change going through until the work order has been read again:
    the page dims, its buttons wait and a bar runs along the header, for at
    least SETTLE_MS (invoice, hold, resume, query, exclusion, refresh).
  */
  const [settleSince, setSettleSince] = useState<number | null>(null);
  const settle = () => setSettleSince(Date.now());
  useEffect(() => {
    if (settleSince === null || loading) return;
    const timer = setTimeout(() => setSettleSince(null), Math.max(0, SETTLE_MS - (Date.now() - settleSince)));
    return () => clearTimeout(timer);
  }, [settleSince, loading]);
  const updating = busy || refreshing || settleSince !== null;

  /* Run a change; the list behind it is stale too, so every cached page is dropped. */
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      setNoteAsk(null);
      setExclusionOpen(false);
      setSelected(new Set());
      settle();
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not go through");
      reload();
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await financeService.refreshWorkOrder(id);
      toast.success("Read from Zoho FSM");
      settle();
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zoho FSM could not be read");
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !data) {
    return (
      <div className="flex flex-col gap-4">
        {/no such work order/i.test(error) ? (
          <Card className="p-0">
            <EmptyState icon={<FileText />} title="This work order is not in Zoho FSM" description="The link may be wrong, or it was removed in FSM." />
          </Card>
        ) : (
          <ErrorState title="Could not load this work order" message={error} onRetry={reload} retrying={loading} />
        )}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  }

  const { workOrder: wo, quotation, lines, invoicing, can: allowed, workflow } = data;
  /*
    The roles decide (2 Nov, no tabs): Finance records invoices; Operations
    records % done and marks ready; both raise queries, hold and mark not
    invoiceable. Someone in both gets both sets of buttons, writes as Finance
    and, on a query waiting on Operations, answers as Operations.
  */
  const financeSide = allowed.invoice || allowed.query;
  const operationsSide = allowed.progress || allowed.markReady || allowed.answer;
  const bothTeams = financeSide && operationsSide;
  const team: "finance" | "operations" = financeSide ? "finance" : "operations";
  const can: Can = allowed;
  const linesValue = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const completed = lines.filter((l) => l.status === "Completed");
  /* Non-billable by its status, or by FSM's Billing Status with no line billable (WO3000: In Progress and Non Billable). */
  const nonBillable = isNonBillable(wo.invoicingStatus);
  /* Non-billable, or Void, Cancelled or Closed in FSM (30 Oct): nothing more is done on it here. */
  const fsmEnded = nonBillable || isEnded(wo.status);
  const fsmLink = fsmRecordLink("Work_Orders", wo.id);
  const verifiedExclusion = workflow === "excluded" ? ([...data.exclusions].reverse().find((x) => x.decision === "verified" && !x.revertedAt) ?? null) : null;
  const live = data.ledgerReady && workflow !== "excluded";
  /* On hold is paused: nothing is invoiced until it is resumed (23 Oct); nor while a "not invoiceable" query is open (2 Nov). */
  const notInvoiceableOpen = (queries.data?.rows ?? []).some((t) => t.status === "open" && t.kind === "not_invoiceable");
  const canInvoice = can.invoice && live && workflow !== "on_hold" && !notInvoiceableOpen;
  const invoiceable = (list: WorkOrderLine[]) => list.filter((l) => l.remaining > 0);
  /* What may be invoiced now (lib/finance/progress.ts): all of it once Completed and flagged, else Operations' percentage. */
  const allowedNow = (l: WorkOrderLine) => l.cap > 0.005;
  const selectable = canInvoice;
  const chosen = lines.filter((l) => selected.has(l.id));
  /* With VAT, each line at its own rate. */
  const vatSum = (list: WorkOrderLine[], amountOf: (l: WorkOrderLine) => number) => round2(list.reduce((sum, l) => sum + withVat(amountOf(l), l), 0));
  const readyWithVat = vatSum(lines, (l) => l.cap);
  const recognisedWithVat = vatSum(lines, (l) => l.recognised);
  const invoicedWithVat = vatSum(lines, (l) => l.invoicedAmount);
  const remainingWithVat = vatSum(lines, (l) => l.remaining);
  const linesWithVat = vatSum(lines, (l) => l.amount ?? 0);
  /* Lines FSM bills as Non Billable on an otherwise billable work order. */
  const nonBillableWithVat = vatSum(lines.filter((l) => !l.billable), (l) => l.amount ?? 0);

  const act = (action: Action, label: string, text?: string) =>
    run(label, () => financeService.workOrderAction(id, { action, expectedStatus: workflow, note: text ?? null, as: team }));
  const ask = (dialogAsk: NoteAsk) => {
    setNote("");
    setNoteAsk(dialogAsk);
  };

  /*
    What is not ready yet, in the person's words: Completed in FSM, the
    quotation's flag, or Operations' percentage.
  */
  const notReadyReason = fsmEnded
    ? nonBillable && !isNonBillable(wo.status)
      ? "the work order's Billing Status is Non Billable in Zoho FSM, so it is never invoiced"
      : `the work order is ${wo.status} in Zoho FSM, so it is never invoiced`
    : [
      wo.status === "Completed" ? null : `the work order is ${wo.status ?? "not completed"} in Zoho FSM, not Completed`,
      data.flagged === null ? "it has no quotation to flag To Be Invoiced" : data.flagged ? null : "its quotation's Post to MAHER is not \"To Be Invoiced\"",
    ]
      .filter(Boolean)
      .join(", and ");
  /*
    Only what may be invoiced now is offered (26 Oct). From the header, the
    lines with something allowed; from the lines ticked, all of them or none:
    a line that may not be invoiced says why instead of being dropped.
  */
  const startInvoice = (how: "record" | "upload", candidates: WorkOrderLine[], picked: boolean) => {
    const waiting = candidates.filter((l) => !allowedNow(l));
    const usable = candidates.filter(allowedNow);
    /* 2 Nov: each line's own reason, in words. */
    const whyNot = (l: WorkOrderLine) =>
      l.remaining <= 0.005
        ? `"${l.name ?? "A line"}" is already invoiced in full`
        : l.progress && l.progress.purpose === "invoice" && l.invoicedAmount > 0
          ? `"${l.name ?? "A line"}" is already invoiced up to the ${l.progress.percent}% Operations marked done; Operations must mark more of it done first`
          : l.progress && l.progress.purpose === "revenue_only"
            ? `"${l.name ?? "A line"}" is marked done for revenue only, not to invoice`
            : `"${l.name ?? "A line"}" is not marked complete or partly done to invoice${notReadyReason ? `, and ${notReadyReason}` : ""}`;
    if (!usable.length || (picked && waiting.length)) {
      setBlocked({
        title: "Not ready to invoice",
        description: picked
          ? `${waiting.map(whyNot).join("; ")}. Untick ${waiting.length === 1 ? "it" : "them"} to invoice the rest.`
          : `Nothing on this work order can be invoiced now. ${waiting.map(whyNot).join("; ")}.`,
      });
      return;
    }
    if (how === "record") setInvoiceLines(usable);
    else setUpload({ only: picked ? usable.map((l) => l.id) : null });
  };

  /* What this person may do now, by the workflow status (BRD 5.1 Step 4, 6.8). */
  const actions: React.ReactNode[] = [];
  if (canInvoice && !fsmEnded && invoiceable(lines).length) {
    actions.push(
      <DropdownMenu key="invoice" modal={false}>
        <DropdownMenuTrigger asChild>
          <Button disabled={updating}>
            <ReceiptText className="size-4" />
            Record invoice
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => startInvoice("upload", invoiceable(lines), false)}>
            <FileUp className="size-4" />
            Upload the MAHER invoice
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => startInvoice("record", invoiceable(lines), false)}>
            <ReceiptText className="size-4" />
            Enter the MAHER details
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  }
  /* Void, Cancelled or Closed in FSM (30 Oct): nothing new starts; an open query can still be replied to, a hold resumed. */
  const over = isEnded(wo.status);
  /* 2 Nov: either side raises a query (Finance: a question or not invoiceable; Operations: a question to Finance). */
  const querySide: QuerySide | null = team === "finance" ? (allowed.query ? "finance" : null) : allowed.answer ? "operations" : null;
  const openQueries = (queries.data?.rows ?? []).filter((t) => t.status === "open");
  if (querySide && live && !over && queries.data?.ready) {
    actions.push(
      <Button key="query" variant="outline" disabled={updating} onClick={() => setRaising(true)}>
        <CircleHelp className="size-4" />
        Raise a query
      </Button>,
    );
  }
  if (can.hold && live && !over && ["open", "in_progress"].includes(workflow) && data.queueStatus !== "invoiced") {
    actions.push(
      <Button
        key="hold"
        variant="outline"
        disabled={updating}
        onClick={() =>
          ask({
            action: "put_on_hold",
            title: "Put on hold",
            description: "Say why, for example a client dispute or missing information.",
            label: "Reason",
            submit: "Put on hold",
          })
        }
      >
        <PauseCircle className="size-4" />
        Put on hold
      </Button>,
    );
  }
  if (can.hold && live && workflow === "on_hold") {
    actions.push(
      <Button
        key="resume"
        variant="outline"
        disabled={updating}
        onClick={async () => {
          if (await confirm({ title: "Resume this work order?", description: "It comes off hold and moves back to In Progress.", confirmText: "Resume" })) {
            void act("resume", "Resumed");
          }
        }}
      >
        <PlayCircle className="size-4" />
        Resume
      </Button>,
    );
  }
  /*
    Complete and partially complete (30 Oct), Operations only. Each line is
    marked Complete (100 %, to invoice) or Partially complete (a % below 100,
    to invoice or revenue only). The work order follows its lines and is
    marked Complete only once every billable line is.
  */
  const completionOf = (l: WorkOrderLine) => lineCompletion(l.progress);
  const woCompletion = workOrderCompletion(lines.map((l) => ({ billable: l.billable, completion: completionOf(l) })));
  /* Confirmed as a whole: the entry that counts for every billable line is the work order's own 100 %. */
  const lastProgressEvent = data.events.filter((e) => e.type === "progress_recorded").reduce<WorkOrderEvent | null>((a, e) => (!a || e.at > a.at ? e : a), null);
  const woConfirmed =
    woCompletion.completion === "complete" &&
    (lines.filter((l) => l.billable).every((l) => l.progress?.wholeWorkOrder) || Boolean(lastProgressEvent?.note?.startsWith("Work order marked complete")));
  const notComplete = lines.filter((l) => l.billable && completionOf(l) !== "complete");
  /* 2 Nov: the work order's completion in one plain sentence, the same everywhere on the page. */
  const linesWord = (n: number) => (n === 1 ? "line" : "lines");
  const completionSentence =
    woCompletion.completion === "complete"
      ? woConfirmed
        ? `Complete: all ${woCompletion.billable} ${linesWord(woCompletion.billable)} done, and Operations confirmed the work order complete.`
        : `All ${woCompletion.billable} ${linesWord(woCompletion.billable)} complete. Operations can now confirm the work order complete.`
      : woCompletion.completion === "partial"
        ? `Partially complete: ${woCompletion.complete} of ${woCompletion.billable} ${linesWord(woCompletion.billable)} complete, ${notComplete.length} still to finish. The work order is complete once every line is.`
        : `Not started: none of the ${woCompletion.billable} ${linesWord(woCompletion.billable)} is marked complete yet.`;
  /* Not while it is on hold. */
  const canComplete = can.progress && live && !fsmEnded && data.progressReady && workflow !== "on_hold";
  /* The line table's Action column: Operations, when it may mark lines. */
  const actionColumn = canComplete;
  if (canComplete && !woConfirmed) {
    actions.push(
      <Button
        key="complete"
        variant="outline"
        disabled={updating}
        onClick={async () => {
          if (notComplete.length) {
            setBlocked({
              title: "Not every line is complete",
              description: `The work order can be marked complete only when every line is. Not complete yet: ${notComplete
                .map((l) => `${l.name ?? "a line"} (${completionOf(l) === "partial" ? `partially complete, ${l.progress?.percent}%` : "not started"})`)
                .join(", ")}. Mark each one Complete in the Line items table first.`,
            });
            return;
          }
          /*
            30 Oct: no question here. Each line keeps the answer it was given
            (to invoice or revenue only); one shared answer is recorded once for
            the work order, mixed answers line by line.
          */
          if (
            await confirm({
              title: "Mark the work order complete?",
              description: "Every line is complete. Each keeps what it was marked: to invoice or revenue only. Nothing is invoiced here.",
              confirmText: "Mark complete",
            })
          ) {
            const billable = lines.filter((l) => l.billable);
            const answers = [...new Set(billable.map((l) => l.progress?.purpose ?? "invoice"))];
            const entries =
              answers.length === 1
                ? [{ line: null, percent: 100, purpose: answers[0] }]
                : billable.map((l) => ({ line: l.id, percent: 100, purpose: l.progress?.purpose ?? ("invoice" as const) }));
            void run("Work order marked complete", async () => toastFsm((await financeService.recordProgress(id, { entries, note: "Work order marked complete" })).data.fsm));
          }
        }}
      >
        <CheckCheck className="size-4" />
        Complete work order
      </Button>,
    );
  }
  if (canComplete && notComplete.some((l) => l.remaining > 0.005)) {
    actions.push(
      <Button key="partial" variant="outline" disabled={updating} onClick={() => setPartialFor({ lines: notComplete.filter((l) => l.remaining > 0.005) })}>
        <Percent className="size-4" />
        Partially complete
      </Button>,
    );
  }
  if (can.exclude && live && !fsmEnded && invoicing.invoicedValue === 0) {
    actions.push(
      <Button
        key="exclude"
        variant="outline"
        disabled={updating}
        onClick={() => {
          setFormSession((n) => n + 1);
          setExclusionOpen(true);
        }}
      >
        Mark not invoiceable
      </Button>,
    );
  }
  if (can.exclude && data.ledgerReady && workflow === "excluded" && !fsmEnded) {
    actions.push(
      <Button
        key="invoiceable"
        variant="outline"
        disabled={updating}
        onClick={() =>
          ask({
            action: "mark_invoiceable",
            title: "Mark invoiceable again",
            description: "Add a note if you want to.",
            label: "Note (optional)",
            submit: "Mark invoiceable",
            optional: true,
          })
        }
      >
        <Undo2 className="size-4" />
        Mark invoiceable
      </Button>,
    );
  }

  /* What the work order waits on, in a band along the header's bottom edge. */
  const band = !data.ledgerReady ? (
    <Band tone="neutral" icon={<Info />} title="Ready marks, workflow and invoices are off">
      Ready to invoice is not set up yet (a database update is still to be applied), so work cannot be marked complete, queried or invoiced here.
    </Band>
  ) : verifiedExclusion ? (
    <Band tone="neutral" icon={<ShieldCheck />} title="Not invoiceable">
      <p>
        {verifiedExclusion.reason}
        {verifiedExclusion.notes ? ` (${verifiedExclusion.notes})` : ""}. Marked by {verifiedExclusion.requestedBy ?? "someone"}
        {verifiedExclusion.markedBySide ? ` (${verifiedExclusion.markedBySide === "finance" ? "Finance" : "Operations"})` : ""}
        {verifiedExclusion.decidedAt ? `, ${at(verifiedExclusion.decidedAt)}` : ""}.
      </p>
      <EvidenceLinks urlOf={(path) => financeService.workOrderEvidenceUrl(id, path)} paths={verifiedExclusion.evidence} />
    </Band>
  ) : workflow === "query_raised" || openQueries.length ? (
    <Band
      tone="warning"
      icon={<CircleHelp />}
      title={
        openQueries.length > 1
          ? `${openQueries.length} open queries`
          : openQueries[0]?.waitingOn
            ? `Query waiting on ${openQueries[0].waitingOn === "finance" ? "Finance" : "Operations"}`
            : "Open query"
      }
    >
      {openQueries[0]?.subject ?? data.queryText ?? "No question recorded."}
      <p className="mt-1 text-xs">Reply on the Queries tab.</p>
      {can.invoice && notInvoiceableOpen ? (
        <p className="mt-1 text-xs">
          No invoice can be recorded while the &quot;not invoiceable&quot; query is open: Operations corrects the completion or withdraws the request, or you close
          the query.
        </p>
      ) : null}
    </Band>
  ) : workflow === "on_hold" ? (
    <Band tone="warning" icon={<PauseCircle />} title="On hold">
      {data.holdReason ?? "No reason recorded."}
      {can.invoice ? <p className="mt-1 text-xs">No invoice can be recorded while it is on hold: resume it first.</p> : null}
    </Band>
  ) : invoicing.status === "invoiced" ? (
    <Band tone="good" icon={<ReceiptText />} title="Invoiced in full">
      {aed(invoicing.invoicedValue)} on {data.invoices.length} MAHER {data.invoices.length === 1 ? "invoice" : "invoices"}. These lines are never presented again.
    </Band>
  ) : invoicing.status === "partially_invoiced" ? (
    <Band tone="warning" icon={<ReceiptText />} title="Partially invoiced">
      {aed(invoicedWithVat)} invoiced; {aed(remainingWithVat)} still to invoice, of which {aed(readyWithVat)} can be invoiced now. All incl. VAT.
    </Band>
  ) : fsmEnded ? (
    <Band tone="neutral" icon={<Info />} title={isEnded(wo.status) ? `${wo.status} in Zoho FSM` : "Non-billable"}>
      {isVoid(wo.status)
        ? "The work order was voided in FSM: nothing is invoiced or recognised."
        : isCancelledOrClosed(wo.status)
          ? `The work order is ${wo.status} in FSM: it is not completed, invoiced or recognised here, and nothing new can be started on it.${invoicing.invoicedValue > 0 ? " What was invoiced before stays recorded." : ""}`
          : isNonBillable(wo.status)
          ? "Non-billable in FSM and not to be invoiced (for example AMC or free service work). It is kept apart from billable work."
          : `Its Billing Status is Non Billable in Zoho FSM (it is ${wo.status ?? "open"}), so nothing on it is invoiced or recognised. It is kept apart from billable work.`}
    </Band>
  ) : invoicing.status === "ready" ? (
    <Band tone="brand" icon={<CheckCheck />} title="Ready to invoice">
      {data.readyForFinance
        ? `${aed(readyWithVat)} incl. VAT: Completed in FSM and flagged To Be Invoiced.`
        : `${aed(readyWithVat)} incl. VAT, as far as Operations has recorded the work done to invoice.`}
    </Band>
  ) : lines.length ? (
    <Band tone="neutral" icon={<TriangleAlert />} title="Not ready to invoice">
      Nothing can be invoiced yet: {notReadyReason}. Operations can record how much is done to invoice it in part.
    </Band>
  ) : null;

  return (
    <div className="flex flex-col gap-4" aria-busy={updating || undefined}>
      <Card className="relative gap-0 overflow-hidden p-0">
        {updating ? <div className="bg-brand absolute inset-x-0 top-0 h-0.5 animate-pulse" role="progressbar" aria-label="Updating" /> : null}
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {wo.type ? <Badge variant="outline">{wo.type}</Badge> : null}
              {/* FSM's status, unless it says the same as the portal's beside the title (2 Nov). */}
              {wo.status?.toLowerCase() !== QUEUE_STATUS_LABELS[data.queueStatus]?.toLowerCase() ? <WorkOrderStatusBadge status={wo.status} /> : null}
              {/* 30 Oct: Operations' completion, beside FSM's own status. */}
              {!fsmEnded && woCompletion.completion !== "not_started" ? (
                <Badge
                  variant="secondary"
                  className={cn("border-0", woCompletion.completion === "complete" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}
                  title={`Marked by Operations: ${woCompletion.complete} of ${woCompletion.billable} billable lines complete`}
                >
                  {woCompletion.completion === "complete"
                    ? woConfirmed
                      ? "Complete"
                      : "All lines complete"
                    : `Partially complete · ${woCompletion.complete} of ${woCompletion.billable} ${linesWord(woCompletion.billable)}`}
                </Badge>
              ) : null}
              {data.flagged ? (
                <Badge variant="secondary" className="bg-success/10 text-success border-0">
                  To Be Invoiced
                </Badge>
              ) : null}
              <span className="text-muted-foreground text-xs">Raised {wo.createdAt ? formatZonedDate(wo.createdAt) : "—"}</span>
            </div>
            <div className="flex flex-row flex-wrap items-center gap-2">
              <h2 className="text-2xl">{quotation?.number ? `Quotation ${quotation.number}` : (wo.number ?? wo.id)}</h2>
              <WorkOrderQueueBadge status={data.queueStatus} />
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                quotation?.number ? wo.number : null,
                wo.contactName,
                wo.companyName,
                wo.ownerName ? `coordinator ${wo.ownerName}` : null,
                data.assigneeName ? `with ${data.assigneeName}` : null,
                data.statusSince ? `${daysSince(data.statusSince)} day(s) in this status` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {fsmLink ? (
              <Button asChild variant="ghost" size="icon" aria-label="Open in FSM" title="Open in FSM">
                <a href={fsmLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={updating} aria-label="Refresh from Zoho FSM" title="Refresh from Zoho FSM">
              <RefreshCw className={cn("size-4", updating && "animate-spin")} />
            </Button>
          </div>
        </div>
        {band}
        <div className="bg-muted/40 border-t px-5 py-2.5">
          {updating ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Updating the work order…
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Read from Zoho FSM {timeAgo(data.fetchedAt)} ({at(data.fetchedAt)}){data.fromCache ? ", kept for ten minutes" : ""}. Refresh reads it again.
            </p>
          )}
        </div>
      </Card>

      <Tabs defaultValue="lines" className={cn("transition-opacity", updating && "pointer-events-none opacity-60")}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="lines">
            Line items
            <TabCount value={lines.length} />
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices
            <TabCount value={data.invoices.length} />
          </TabsTrigger>
          <TabsTrigger value="queries">
            Queries
            <TabCount value={openQueries.length || undefined} />
          </TabsTrigger>
          <TabsTrigger value="history">
            History
            <TabCount value={data.events.length} />
          </TabsTrigger>
          <TabsTrigger value="quotation">Quotation</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="mt-4 flex flex-col gap-6">
          <StatCardGrid columns={5}>
            <StatCard
              label="Work order value"
              value={aed(wo.grandTotal ?? linesWithVat)}
              headline={
                !nonBillable && nonBillableWithVat > 0.005
                  ? `Incl. VAT, of which ${aed(nonBillableWithVat)} non-billable`
                  : "Incl. VAT, as totalled in FSM"
              }
            />
            <StatCard
              label="Ready to invoice"
              value={aed(readyWithVat)}
              headline={invoicing.readyValue > 0 ? (data.readyForFinance ? "Incl. VAT, completed and flagged" : "Incl. VAT, as far as recorded done") : "Nothing to invoice now"}
              tone={invoicing.readyValue > 0 ? "progress" : "neutral"}
            />
            <StatCard
              label="Recognised revenue"
              value={aed(recognisedWithVat)}
              headline={fsmEnded ? "Not billable" : wo.status === "Completed" ? "Incl. VAT, completed in FSM" : "Incl. VAT, by % done"}
            />
            <StatCard
              label="Invoiced"
              value={aed(invoicedWithVat)}
              headline={
                fsmEnded
                  ? "Nothing to invoice: not billable"
                  : invoicing.remainingValue > 0
                    ? `${aed(remainingWithVat)} left to invoice`
                    : lines.length
                      ? INVOICE_STATUS_LABELS[invoicing.status]
                      : "No line items"
              }
              tone={invoicing.status === "invoiced" ? "good" : "neutral"}
            />
            <StatCard
              label="Lines complete"
              value={`${woCompletion.complete} / ${woCompletion.billable}`}
              headline={
                woCompletion.completion === "complete"
                  ? woConfirmed
                    ? "Work order complete, confirmed by Operations"
                    : "All lines complete; the work order is not yet confirmed"
                  : woCompletion.completion === "partial"
                    ? `Partially complete: ${notComplete.length} ${linesWord(notComplete.length)} still to finish`
                    : "Not started"
              }
              caption={`In Zoho FSM: ${completed.length} of ${lines.length} completed${wo.completedAt ? `, work order completed ${formatZonedDate(wo.completedAt)}` : ""}`}
              tone={woCompletion.completion === "complete" ? "good" : "neutral"}
            />
          </StatCardGrid>

          <SectionCard
            icon={<ListChecks />}
            title="Line items"
            description={`${completionSentence} Values are before VAT.`}
            bodyClassName="border-t"
            action={
              selectable && chosen.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-sm">{chosen.length} selected</span>
                  {invoiceable(chosen).length ? (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" disabled={busy}>
                          <ReceiptText className="size-4" />
                          Invoice selected
                          <ChevronDown className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => startInvoice("upload", invoiceable(chosen), true)}>
                          <FileUp className="size-4" />
                          Upload the MAHER invoice
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => startInvoice("record", invoiceable(chosen), true)}>
                          <ReceiptText className="size-4" />
                          Enter the MAHER details
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="text-muted-foreground text-sm">Already invoiced in full</span>
                  )}
                </div>
              ) : undefined
            }
          >
            {lines.length === 0 ? (
              <p className="text-muted-foreground px-5 py-4 text-sm">This work order has no line items in Zoho FSM.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectable ? (
                      <TableHead className="w-10 pl-5">
                        <Checkbox
                          checked={selected.size === lines.length ? true : selected.size ? "indeterminate" : false}
                          onCheckedChange={(checked) => setSelected(checked ? new Set(lines.map((l) => l.id)) : new Set())}
                          aria-label="Select every line"
                        />
                      </TableHead>
                    ) : null}
                    <TableHead className={selectable ? undefined : "pl-5"}>Line item</TableHead>
                    <TableHead>FSM status</TableHead>
                    <TableHead>Invoicing</TableHead>
                    <TableHead>Completion</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    {actionColumn ? <TableHead className="text-center">Action</TableHead> : null}
                    <TableHead className="pr-5 text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id} data-state={selected.has(line.id) ? "selected" : undefined}>
                      {selectable ? (
                        <TableCell className="pl-5">
                          <Checkbox
                            checked={selected.has(line.id)}
                            onCheckedChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(line.id)) next.delete(line.id);
                                else next.add(line.id);
                                return next;
                              })
                            }
                            aria-label={`Select ${line.name ?? "line"}`}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell className={selectable ? undefined : "pl-5"}>
                        <LineName name={line.name} description={line.description} className="max-w-72" />
                        {line.isOptional ? (
                          <Badge variant="outline" className="mt-1">
                            Optional
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <WorkOrderStatusBadge status={line.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          {!line.billable ? (
                            <WorkOrderStatusBadge status="Non-billable" />
                          ) : (
                            <InvoiceStatusBadge status={line.invoiceStatus} />
                          )}
                          {line.invoiceStatus === "partially_invoiced" ? (
                            <p className="text-muted-foreground text-xs tabular-nums">
                              {aed(line.invoicedAmount)} invoiced · {aed(line.remaining)} left
                            </p>
                          ) : null}
                          {line.cap > 0.005 && line.cap < line.remaining - 0.005 ? (
                            <p className="text-warning text-xs tabular-nums">Up to {aed(line.cap)} now</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {line.billable ? (
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant={completionOf(line) === "complete" ? "default" : "outline"}>{COMPLETION_LABELS[completionOf(line)]}</Badge>
                            {line.progress && completionOf(line) !== "not_started" ? (
                              <p className="text-muted-foreground text-xs tabular-nums">
                                {line.progress.percent}% · {PROGRESS_PURPOSE_LABELS[line.progress.purpose].toLowerCase()}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantity ?? "—"}
                        {line.unit ? <span className="text-muted-foreground"> {line.unit}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{aed(line.unitPrice)}</TableCell>
                      {/* Operations marks this one line ready to invoice (27 Oct), second-last column. */}
                      {actionColumn ? (
                        <TableCell className="text-center">
                          {/* Until it is invoiced in full, a line can be marked or changed (30 Oct: Complete, or Partially complete). */}
                          {line.billable && line.remaining > 0.005 ? (
                            <div className="flex justify-center gap-1.5">
                              {completionOf(line) !== "complete" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  disabled={updating}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCompleteFor({ line });
                                  }}
                                >
                                  <CheckCheck className="size-4" />
                                  Complete
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                disabled={updating}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPartialFor({ lines: [line] });
                                }}
                              >
                                {completionOf(line) === "not_started" ? <Percent className="size-4" /> : <Pencil className="size-4" />}
                                {completionOf(line) === "not_started" ? "Partial" : "Change"}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="pr-5 text-right font-medium tabular-nums">
                        {aed(line.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="pl-5 font-medium" colSpan={(selectable ? 7 : 6) + (actionColumn ? 1 : 0)}>
                      Total
                    </TableCell>
                    <TableCell className="pr-5 text-right font-semibold tabular-nums">
                      {aed(linesValue)}
                      <div className="text-muted-foreground text-xs font-normal">incl. VAT {aed(linesWithVat)}</div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <InvoicesCard workOrderId={id} invoices={data.invoices} lines={lines} />
        </TabsContent>

        <TabsContent value="queries" className="mt-4">
          <QueriesCard
            queries={queries.data}
            error={queries.error}
            loading={queries.loading}
            preferredSide={bothTeams ? null : querySide}
            lineNames={new Map(lines.map((l) => [l.id, l.name ?? "A line"]))}
            onChanged={() => {
              settle();
              refreshAll();
            }}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryCard events={data.events} />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <ReportsCard workOrderId={id} appointments={data.appointmentIds.length} />
        </TabsContent>

        <TabsContent value="quotation" className="mt-4">
          {quotation?.document ? (
            <QuotationDocument quotation={quotation} document={quotation.document} />
          ) : (
            <SectionCard
              icon={<FileText />}
              title="Quotation"
              description={quotation ? "As in Zoho FSM." : undefined}
              bodyClassName={quotation ? "px-5 pb-5" : "border-t"}
            >
              {quotation ? (
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Fact label="Number" value={quotation.number ?? "—"} />
                  <Fact label="Status in FSM" value={quotation.status ?? "—"} />
                  <Fact label="Total before VAT" value={aed(quotation.subTotal)} />
                  <Fact label="Total with VAT" value={aed(quotation.grandTotal)} />
                  <Fact label="Owner (coordinator)" value={quotation.ownerName ?? "—"} />
                  <Fact label="Client contact" value={quotation.contactName ?? "—"} />
                  <Fact label="Post to MAHER" value={quotation.postToMaher ?? "—"} />
                  <Fact label="Valid until" value={quotation.expiryDate ? formatZonedDate(quotation.expiryDate) : "—"} />
                </dl>
              ) : (
                <EmptyState
                  icon={<FileText className="size-6" />}
                  title="No quotation linked"
                  description="This work order has no quotation linked in Zoho FSM. Once one is linked there, it shows here."
                />
              )}
            </SectionCard>
          )}
        </TabsContent>

      </Tabs>

      <Dialog open={noteAsk !== null} onOpenChange={(open) => !open && !busy && setNoteAsk(null)}>
        <ActionDialogContent busy={busy}>
          <DialogHeader>
            <DialogTitle>{noteAsk?.title}</DialogTitle>
            {noteAsk?.description ? <DialogDescription>{noteAsk.description}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="wo-note">{noteAsk?.label}</Label>
            <Textarea id="wo-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteAsk(null)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton
              pending={busy}
              disabled={!note.trim() && !noteAsk?.optional}
              onClick={() => {
                if (!noteAsk) return;
                if (noteAsk.action === "mark_invoiceable") void run("Marked invoiceable", () => financeService.markInvoiceable(id, { note: note.trim() || null, as: team }));
                else void act(noteAsk.action, `${noteAsk.submit}: done`, note.trim());
              }}
            >
              {noteAsk?.submit}
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>

      <ExclusionDialog
        key={`exclusion-${formSession}`}
        open={exclusionOpen}
        busy={busy}
        verifiedAtOnce
        onClose={() => !busy && setExclusionOpen(false)}
        onSubmit={({ files, ...input }) => {
          /* Either side's word is enough: marked at once, and the other side is told (2 Nov). */
          void run("Marked not invoiceable", async () => {
            const evidence = await uploadEvidenceFiles(files, (sign) => financeService.signWorkOrderEvidenceUpload(id, sign));
            return financeService.markNotInvoiceable(id, { ...input, evidence, as: team });
          });
        }}
      />

      {querySide && queries.data ? (
        <RaiseQueryDialog
          key={`query-${formSession}`}
          open={raising}
          onClose={() => setRaising(false)}
          workOrderId={id}
          workOrderNumber={wo.number}
          side={querySide}
          people={queries.data.tagOptions}
          lines={lines.filter((l) => l.billable).map((l) => ({ id: l.id, name: l.name }))}
          onRaised={() => {
            setRaising(false);
            setFormSession((n) => n + 1);
            settle();
            refreshAll();
          }}
        />
      ) : null}

      {invoiceLines ? (
        <RecordInvoiceDialog
          workOrderId={id}
          lines={invoiceLines}
          onClose={() => setInvoiceLines(null)}
          onRecorded={() => {
            setInvoiceLines(null);
            setSelected(new Set());
            settle();
            refreshAll();
          }}
        />
      ) : null}
      {partialFor ? (
        <ProgressDialog
          workOrderId={id}
          lines={partialFor.lines}
          onClose={() => setPartialFor(null)}
          onRecorded={() => {
            setPartialFor(null);
            settle();
            refreshAll();
          }}
        />
      ) : null}
      {completeFor ? (
        <CompleteDialog
          workOrderId={id}
          line={completeFor.line}
          onClose={() => setCompleteFor(null)}
          onRecorded={() => {
            setCompleteFor(null);
            settle();
            refreshAll();
          }}
        />
      ) : null}
      {upload ? (
        <UploadInvoiceDialog
          workOrderId={id}
          onlyLines={upload.only}
          onClose={() => setUpload(null)}
          onRecorded={() => {
            setUpload(null);
            setSelected(new Set());
            settle();
            refreshAll();
          }}
        />
      ) : null}

      <Dialog open={blocked !== null} onOpenChange={(open) => !open && setBlocked(null)}>
        <ActionDialogContent busy={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="text-warning size-5" />
              {blocked?.title}
            </DialogTitle>
            <DialogDescription>{blocked?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {fsmLink ? (
              <Button asChild variant="outline">
                <a href={fsmLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  Open in FSM
                </a>
              </Button>
            ) : null}
            <Button onClick={() => setBlocked(null)}>OK</Button>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}

/* ---------------------------------------------------------------------
   Record a MAHER invoice: which lines, how much of each (in full or a
   part, as an amount or a %), the invoice's number, date and total.
   --------------------------------------------------------------------- */

const round2 = (n: number) => Math.round(n * 100) / 100;

function RecordInvoiceDialog({
  workOrderId,
  lines,
  onClose,
  onRecorded,
}: {
  workOrderId: string;
  lines: WorkOrderLine[];
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [included, setIncluded] = useState<Set<string>>(() => new Set(lines.map((l) => l.id)));
  /* 2 Nov: each line is typed before VAT, its net amount; VAT is worked out once on the invoice total. */
  /* No more than may be invoiced now: all that is left once ready for Finance, else Operations' percentage (filled in). */
  const allowed = (line: WorkOrderLine) => Math.min(line.remaining, line.cap);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(allowed(l))])));
  const leftWithVat = (line: WorkOrderLine) => allowed(line);
  const beforeVat = (_line: WorkOrderLine, typed: number) => typed;
  /* The MAHER invoice PDF (26 Oct, change 6): required, kept with the invoice. */
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => todayInZone());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const allocations = lines
    .filter((l) => included.has(l.id))
    .map((l) => {
      const typed = Number(amounts[l.id]);
      return { line: l, typed, amount: Number.isFinite(typed) ? beforeVat(l, typed) : NaN };
    });
  const badLine = allocations.find((a) => !(a.typed > 0) || a.typed > leftWithVat(a.line) + 0.005);
  /* The invoice total: the lines' net total, plus VAT on it (2 Nov); the server works it out the same way. */
  const totals = invoiceTotals(allocations.map((a) => ({ amount: a.amount, line: a.line })));
  const sumWithVat = totals.total;
  const valid = allocations.length > 0 && !badLine && number.trim() && date && sumWithVat > 0 && file;

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const signed = await financeService.signInvoiceUpload({ fileName: file.name, contentType: file.type, size: file.size, scan: false });
      const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": signed.contentType }, body: file });
      if (!put.ok) throw new Error(`${file.name} did not upload. Try again.`);
      await financeService.recordLineInvoice({
        idempotencyKey: key,
        number: number.trim(),
        date,
        total: sumWithVat,
        note: note.trim() || null,
        allocations: allocations.map((a) => ({ line: a.line.id, workOrder: workOrderId, amount: round2(a.amount) })),
        filePath: signed.path,
      });
      toast.success(`MAHER ${number.trim()} recorded`);
      onRecorded();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Nothing was recorded");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      {/* As high as its content, up to the screen; the middle scrolls, the title and buttons stay. */}
      <ActionDialogContent busy={busy} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a MAHER invoice</DialogTitle>
          <DialogDescription>Tick the lines it covers and how much of each, before VAT. VAT is added once, on the invoice total. The rest stays to invoice later.</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-x-hidden overflow-y-auto px-4 py-0.5">
          {/* One card per line: tick it, then the full amount left or a part of it, as AED or a %. */}
          <div className="grid gap-3">
            {lines.map((line) => {
              const on = included.has(line.id);
              const value = amounts[line.id] ?? "";
              const typed = Number(value);
              const left = leftWithVat(line);
              const over = on && typed > left + 0.005;
              const percent = line.amount && Number.isFinite(typed) ? round2((beforeVat(line, typed) / line.amount) * 100) : 0;
              const toggle = (checked: boolean) =>
                setIncluded((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(line.id);
                  else next.delete(line.id);
                  return next;
                });
              return (
                <div
                  key={line.id}
                  className={cn(
                    "min-w-0 rounded-lg border px-3 py-2 transition-colors",
                    on ? "border-brand/40 bg-brand-50/40" : "bg-muted/30",
                    over && "border-destructive",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Checkbox className="mt-0.5" checked={on} onCheckedChange={(checked) => toggle(Boolean(checked))} aria-label={`Include ${line.name ?? "line"}`} />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(!on)}>
                      <LineName name={line.name} description={line.description} />
                      <p className="text-muted-foreground text-xs tabular-nums">
                        <span className="text-foreground font-medium">{aed(left)}</span> {line.cap < line.remaining - 0.005 ? "allowed now" : "left"}
                        {line.invoicedAmount > 0 ? ` · ${aed(line.invoicedAmount)} invoiced before` : ""}
                      </p>
                    </button>
                  </div>

                  {/* One row: the % and the amount with VAT; under it what is left after, or Full amount. */}
                  {on ? (
                    <div className="mt-2 grid gap-1 pl-6">
                      <div className="flex items-center gap-2">
                        <div className="relative w-20 shrink-0">
                          <Input
                            id={`pct-${line.id}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step="0.01"
                            aria-label={`Percent of ${line.name ?? "the line"}`}
                            className="h-7 pr-6 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            value={line.amount ? String(percent) : ""}
                            onChange={(e) => {
                              const p = Number(e.target.value);
                              if (Number.isFinite(p) && line.amount) setAmounts((prev) => ({ ...prev, [line.id]: String(round2((line.amount! * p) / 100)) }));
                            }}
                          />
                          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs">%</span>
                        </div>
                        <div className="relative min-w-0 flex-1">
                          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs">AED</span>
                          <Input
                            id={`amt-${line.id}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            aria-label={`Amount of ${line.name ?? "the line"} on this invoice, before VAT`}
                            aria-invalid={over || undefined}
                            className={cn("h-7 pl-9 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", over && "border-destructive")}
                            value={value}
                            onChange={(e) => setAmounts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-[11px]", over ? "text-destructive" : "text-muted-foreground")}>
                          {over
                            ? `More than the ${aed(left)} left.`
                            : typed > 0
                              ? `${aed(Math.max(0, round2(line.remaining - typed)))} left on the line after`
                              : "Enter an amount or a %."}
                        </p>
                        {Math.abs(typed - left) >= 0.005 ? (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto shrink-0 p-0 text-[11px]"
                            onClick={() => setAmounts((prev) => ({ ...prev, [line.id]: String(left) }))}
                          >
                            Full amount
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <InvoiceTotals totals={totals} />

          <div className="grid gap-1.5">
            <Label htmlFor="maher-file">MAHER invoice PDF</Label>
            <input
              ref={fileInput}
              id="maher-file"
              type="file"
              accept=".pdf,application/pdf"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (picked && !/\.pdf$/i.test(picked.name)) {
                  setProblem(`${picked.name} is not a PDF.`);
                  return;
                }
                if (picked && picked.size > 10 * 1024 * 1024) {
                  setProblem(`${picked.name} is over 10 MB.`);
                  return;
                }
                setProblem(null);
                setFile(picked);
              }}
            />
            {file ? (
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <FileText className="text-brand size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>
                  {file.name}
                </span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setFile(null)} aria-label="Remove the PDF" disabled={busy}>
                  <XCircle className="size-4" />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="justify-start" onClick={() => fileInput.current?.click()} disabled={busy}>
                <Upload className="size-4" />
                Choose the invoice PDF
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="maher-number">MAHER invoice number</Label>
              <Input id="maher-number" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="maher-date">Invoice date</Label>
              <Input id="maher-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="maher-note">Note</Label>
            <Textarea id="maher-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {badLine ? (
            <p className="text-destructive text-sm">
              {badLine.line.name ?? "A line"}: enter an amount above zero and no more than {aed(leftWithVat(badLine.line))}.
            </p>
          ) : null}
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!valid} onClick={() => void submit()}>
            Record invoice
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------
   Operations: Partially complete (30 Oct; "X % done" since 26 Oct), line by
   line: a % above 0 and below 100 (100 % is Complete), either to invoice or
   for revenue only. It fills Finance's side; Operations never records an
   invoice here.
   --------------------------------------------------------------------- */

function ProgressDialog({
  workOrderId,
  lines,
  onClose,
  onRecorded,
}: {
  workOrderId: string;
  lines: WorkOrderLine[];
  onClose: () => void;
  onRecorded: () => void;
}) {
  /* Asked, not assumed (27 Oct): is the % done ready to invoice, or revenue only? */
  const [purpose, setPurpose] = useState<ProgressPurpose | null>(null);
  /* Not below what is already invoiced of a line. */
  const floorOf = (l: WorkOrderLine) => (l.amount && l.amount > 0 ? Math.ceil((l.invoicedAmount / l.amount) * 1000) / 10 : 0);
  /*
    Line by line only (27 Oct): each line's % is entered, and the work
    order's overall % follows from them, weighted by each line's value.
    Each line opens at the % it was last given; one never given a % opens
    empty, its least (what is invoiced) shown in the box.
  */
  const [perLine, setPerLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.progress ? String(l.progress.percent) : ""])),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const valid = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= 100;
  /* What is wrong with a line's %, said under the line; null when it is fine or left empty. */
  const problemOf = (l: WorkOrderLine): string | null => {
    const text = (perLine[l.id] ?? "").trim();
    if (text === "") return null;
    if (!valid(text)) return "Enter a % from 0 to 100.";
    if (Number(text) <= 0) return "Enter a % above 0.";
    if (Number(text) < floorOf(l) - 0.05) return `At least ${floorOf(l)}%: that much of this line is already invoiced.`;
    return null;
  };
  const percentOf = (l: WorkOrderLine) => (valid(perLine[l.id] ?? "") ? Number(perLine[l.id]) : null);
  /* 30 Oct: 100 % is Complete, below it Partially complete; either way the answer is asked. */
  const isComplete = (l: WorkOrderLine) => (percentOf(l) ?? 0) >= 100;
  /* A line is recorded when its % or the answer differs from what it has. */
  const changed = lines.filter((l) => {
    const pct = percentOf(l);
    return pct !== null && (!l.progress || Math.abs(l.progress.percent - pct) > 0.001 || l.progress.purpose !== purpose);
  });
  const completing = changed.filter(isComplete);
  const partial = changed.filter((l) => !isComplete(l));
  const entries = purpose ? changed.map((l) => ({ line: l.id, percent: percentOf(l)!, purpose })) : [];
  const lineProblems = lines.filter((l) => problemOf(l) !== null).length;
  const ok = entries.length > 0 && lineProblems === 0;
  /* The overall % the lines come to, weighted by each line's net value. */
  const valueOf = (l: WorkOrderLine) => l.amount ?? 0;
  const totalValue = lines.reduce((sum, l) => sum + valueOf(l), 0);
  const weighted = lines.some((l) => percentOf(l) !== null) && totalValue > 0
    ? round2((lines.reduce((sum, l) => sum + valueOf(l) * (percentOf(l) ?? 0), 0) / totalValue))
    : null;
  /* What Finance could invoice now if it is ready to invoice: each line's % of its value, less what is invoiced already. Incl. VAT. */
  /* A % within 0.1 of what is invoiced (the box rounds it up) adds nothing to invoice. */
  const readyNow = round2(
    lines.reduce((sum, l) => {
      const pct = percentOf(l) ?? 0;
      return pct - floorOf(l) <= 0.1 ? sum : sum + Math.max(0, (valueOf(l) * pct) / 100 - l.invoicedAmount);
    }, 0),
  );
  const question = lines.length > 1 ? "Should these lines be ready to invoice?" : "Should this line be ready to invoice?";
  /* What was done, in words, for the history and the message. */
  const said =
    completing.length && partial.length
      ? `Marked ${completing.length} complete and ${partial.length} partially complete`
      : completing.length
        ? completing.length === 1 ? "Line marked complete" : `Marked ${completing.length} lines complete`
        : "Marked partially complete";

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await financeService.recordProgress(workOrderId, { entries, note: [said, note.trim()].filter(Boolean).join(": ") });
      toast.success(said);
      toastFsm(result.data.fsm);
      onRecorded();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Nothing was recorded");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <ActionDialogContent busy={busy} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How much is done</DialogTitle>
          <DialogDescription>
            How much of {lines.length === 1 ? "this line" : "each line"} is done. Below 100% it is partially complete; 100% marks it Complete. Nothing is invoiced here.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-x-hidden overflow-y-auto px-4 py-0.5">
          <div className="grid gap-2">
            <Label>{lines.length === 1 ? "% done" : "% done of each line"}</Label>
            {lines.map((l) => {
              const lineProblem = problemOf(l);
              return (
                <div key={l.id} className={cn("grid min-w-0 gap-1.5 rounded-lg border px-3 py-2", lineProblem && "border-destructive")}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <LineName name={l.name} description={l.description} />
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {aed(l.amount ?? 0)} before VAT
                        {l.invoicedAmount > 0 ? ` · ${floorOf(l)}% invoiced` : ""}
                        {l.progress ? ` · last ${l.progress.percent}%` : ""}
                      </p>
                    </div>
                    <div className="w-24 shrink-0">
                      <PercentInput
                        id={`progress-${l.id}`}
                        value={perLine[l.id] ?? ""}
                        min={floorOf(l)}
                        placeholder={floorOf(l) > 0 ? `≥ ${floorOf(l)}` : undefined}
                        invalid={Boolean(lineProblem)}
                        onChange={(v) => setPerLine((prev) => ({ ...prev, [l.id]: v }))}
                        label={`% done of ${l.name ?? "the line"}`}
                      />
                    </div>
                  </div>
                  {lineProblem ? (
                    <p className="text-destructive text-xs" role="alert">
                      {lineProblem}
                    </p>
                  ) : isComplete(l) ? (
                    <p className="text-success text-xs">100%: this line is marked Complete.</p>
                  ) : null}
                </div>
              );
            })}
            {weighted !== null ? (
              <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <span className="font-medium">
                  Work order overall <span className="text-muted-foreground font-normal">by line value</span>
                </span>
                <span className="font-semibold tabular-nums">{weighted}%</span>
              </div>
            ) : null}
            <p className="text-muted-foreground text-xs">Leave a line empty to keep what it has.</p>
          </div>

          {/* Finance invoices only what is ready to invoice: asked for every % recorded, Complete included (30 Oct). */}
          <div className="grid gap-2" role="radiogroup" aria-label="Ready to invoice">
            <Label>{question}</Label>
            <div className="grid gap-2">
              {(["invoice", "revenue_only"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={purpose === p}
                  onClick={() => setPurpose(p)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    purpose === p ? "border-brand/40 bg-brand-50/40" : "hover:bg-muted/50",
                  )}
                >
                  <span className="font-medium">{p === "invoice" ? "Yes, ready to invoice" : "No, revenue only"}</span>
                  <span className="text-muted-foreground block text-xs tabular-nums">
                    {p === "invoice"
                      ? weighted !== null
                        ? `Finance may invoice ${aed(readyNow)} before VAT now.`
                        : "Finance may invoice this much now."
                      : "Booked as revenue at month end; not invoiced until it is ready to invoice."}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="progress-note">Note</Label>
            <Textarea id="progress-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!ok} onClick={() => void submit()}>
            {completing.length && !partial.length ? "Mark complete" : "Save"}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/*
  Complete a line (30 Oct): no % to enter (100 %; a part goes through
  Partial or Change), only whether Finance may invoice it or it is revenue
  only.
*/
function CompleteDialog({
  workOrderId,
  line,
  onClose,
  onRecorded,
}: {
  workOrderId: string;
  line: WorkOrderLine;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [purpose, setPurpose] = useState<ProgressPurpose | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const left = round2(Math.max(0, line.remaining));

  const submit = async () => {
    if (!purpose) return;
    setBusy(true);
    setProblem(null);
    try {
      const said = "Line marked complete";
      const result = await financeService.recordProgress(workOrderId, {
        entries: [{ line: line.id, percent: 100, purpose }],
        note: [said, note.trim()].filter(Boolean).join(": "),
      });
      toast.success(said);
      toastFsm(result.data.fsm);
      onRecorded();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Nothing was recorded");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {line.name ?? "this line"} complete</DialogTitle>
          <DialogDescription>100% done. Nothing is invoiced here.</DialogDescription>
        </DialogHeader>
        <PurposeChoice
          question="Should this line be ready to invoice?"
          purpose={purpose}
          onChange={setPurpose}
          invoiceHint={`Finance may invoice ${aed(left)} before VAT now.`}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="complete-note">Note</Label>
          <Textarea id="complete-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!purpose} onClick={() => void submit()}>
            Mark complete
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* Asked for every % recorded (27 Oct, and 30 Oct for Complete too): ready to invoice, or revenue only. */
function PurposeChoice({
  question,
  purpose,
  onChange,
  invoiceHint,
}: {
  question: string;
  purpose: ProgressPurpose | null;
  onChange: (purpose: ProgressPurpose) => void;
  invoiceHint: string;
}) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label="Ready to invoice">
      <Label>{question}</Label>
      <div className="grid gap-2">
        {(["invoice", "revenue_only"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={purpose === p}
            onClick={() => onChange(p)}
            className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", purpose === p ? "border-brand/40 bg-brand-50/40" : "hover:bg-muted/50")}
          >
            <span className="font-medium">{p === "invoice" ? "Yes, ready to invoice" : "No, revenue only"}</span>
            <span className="text-muted-foreground block text-xs tabular-nums">
              {p === "invoice" ? invoiceHint : "Booked as revenue at month end; not invoiced until it is ready to invoice."}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PercentInput({
  id,
  value,
  onChange,
  label,
  min = 0,
  invalid = false,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  min?: number;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={100}
        step="0.1"
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        className="h-8 pr-7 text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs">%</span>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Reports (26 Oct, change 8): the files Zoho FSM holds on the work order
   and on each appointment, the client-signed service reports among them,
   whether or not anything is invoiced. Read when the tab opens.
   --------------------------------------------------------------------- */

const isInspectionReport = (f: LiveAttachment) => /snagging[\s_-]*report|inspection/i.test(f.name);
const fileSize = (bytes: number | null) =>
  bytes === null ? "" : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function ReportsCard({ workOrderId, appointments }: { workOrderId: string; appointments: number }) {
  const { data, loading, error, reload } = useSection<{ serviceReports: LiveServiceReport[]; files: LiveAttachment[]; appointments: number }>(
    `/api/finance/work-orders/${encodeURIComponent(workOrderId)}/attachments`,
    { staleMs: DETAIL_STALE_MS },
  );
  const reports = data?.serviceReports ?? [];
  const files = data?.files ?? [];
  const groups: Array<{ title: string; files: LiveAttachment[] }> = [
    { title: "Inspection reports", files: files.filter(isInspectionReport) },
    { title: "Other files", files: files.filter((f) => !isInspectionReport(f)) },
  ];
  const openLink = (fileId: string) => (
    <Button asChild size="sm" variant="outline">
      <a href={financeService.workOrderFileUrl(workOrderId, fileId)} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="size-4" />
        Open
      </a>
    </Button>
  );

  return (
    <SectionCard
      icon={<FileText />}
      title="Reports"
      description={`FSM's service report for each of this work order's ${data?.appointments ?? appointments} ${(data?.appointments ?? appointments) === 1 ? "appointment" : "appointments"}, the client-signed proof of completion, whenever FSM has generated it; then the files on the work order and its appointments.`}
      bodyClassName="border-t"
    >
      {error && !data ? (
        <div className="p-5">
          <ErrorState title="Could not read the reports in Zoho FSM" message={error} onRetry={reload} retrying={loading} />
        </div>
      ) : !data ? (
        <SectionSkeleton />
      ) : (
        <div className="grid gap-5 p-5">
          <div className="grid gap-2">
            <p className="text-sm font-medium">
              Service reports <span className="text-muted-foreground font-normal">({reports.length})</span>
            </p>
            {reports.length === 0 ? (
              <p className="text-muted-foreground text-sm">FSM has not generated a service report for this work order&apos;s appointments yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {reports.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                    <ReceiptText className="text-muted-foreground size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="truncate">{r.name ?? "Service report"}</span>
                        {r.status ? (
                          <Badge variant="secondary" className={cn("border-0", r.signedBy ? "bg-success/10 text-success" : "bg-mist text-ink-soft")}>
                            {r.status}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {[
                          r.appointmentName ? `Appointment ${r.appointmentName}` : null,
                          r.signedBy ? `signed by ${r.signedBy}${r.signedAt ? `, ${formatWhen(r.signedAt)}` : ""}` : "not signed by the client",
                          r.rating ? `rated ${r.rating}` : null,
                          r.pdf?.size ? fileSize(r.pdf.size) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {r.pdf ? openLink(r.pdf.fileId) : <span className="text-muted-foreground text-xs">No PDF yet</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {groups.map((g) => (
            <div key={g.title} className="grid gap-2">
              <p className="text-sm font-medium">
                {g.title} <span className="text-muted-foreground font-normal">({g.files.length})</span>
              </p>
              {g.files.length === 0 ? (
                <p className="text-muted-foreground text-sm">None.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {g.files.map((f) => (
                    <li key={`${f.parentId}-${f.id}`} className="flex items-center gap-3 px-3 py-2.5">
                      <Paperclip className="text-muted-foreground size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={f.name}>
                          {f.name}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {f.parent === "appointment" ? "On an appointment" : "On the work order"}
                          {f.createdAt ? ` · ${formatWhen(f.createdAt)}` : ""}
                          {f.size !== null ? ` · ${fileSize(f.size)}` : ""}
                        </p>
                      </div>
                      {openLink(f.fileId)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ---------------------------------------------------------------------
   History, laid out as the job page's (audit-timeline.tsx): a row per
   change with its icon, what and who, and when; newest or oldest first,
   a page at a time.
   --------------------------------------------------------------------- */

/* 2 Nov: the work order's queries, each a thread with the reply box for the side the page acts as. */
function QueriesCard({
  queries,
  error,
  loading,
  preferredSide,
  lineNames,
  onChanged,
}: {
  queries: Queries | null;
  error: string | null;
  loading: boolean;
  preferredSide: QuerySide | null;
  lineNames: Map<string, string>;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const rows = queries?.rows ?? [];
  /* A page left empty by a change (the last thread on it closed elsewhere) falls back to the last page there is. */
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const shownPage = Math.min(page, lastPage);
  const shown = rows.slice(shownPage * pageSize, (shownPage + 1) * pageSize);
  if (error && !queries) return <ErrorState title="Could not load the queries" message={error} />;
  if (!queries) return loading ? <SectionSkeleton /> : null;
  return (
    <SectionCard
      icon={<CircleHelp />}
      title="Queries"
      description="Questions between Finance and Operations on this work order, with every reply. The other side is told each time; either side closes it."
      bodyClassName="border-t"
    >
      {!queries.ready ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">Queries can be raised once a database update is applied.</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<CircleHelp className="size-6" />} title="No queries" description="Raise a query from the buttons at the top. It shows here and on the Queries page." />
      ) : (
        <>
          <ul className="divide-y">
            {shown.map((t) => (
              <li key={t.id} className="px-5 py-4">
                <QueryThreadView thread={t} sides={queries.sides} people={queries.tagOptions} preferredSide={preferredSide} lineNames={lineNames} onChanged={onChanged} />
              </li>
            ))}
          </ul>
          <ListPager
            page={shownPage}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            noun="queries"
            className="border-t"
          />
        </>
      )}
    </SectionCard>
  );
}

function HistoryCard({ events }: { events: WorkOrderEvent[] }) {
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const sorted = order === "desc" ? events : [...events].reverse();
  const shown = sorted.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <SectionCard
      title="History"
      icon={<History />}
      description="Every invoice, query, hold and exclusion on this work order."
      bodyClassName="border-t"
      action={
        <Select
          value={order}
          onValueChange={(value) => {
            setOrder(value as "desc" | "asc");
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-[130px]" aria-label="Sort history">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Newest first</SelectItem>
            <SelectItem value="asc">Oldest first</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      {events.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="Nothing recorded yet"
          description="Invoices, queries, holds and exclusions appear here as they happen."
        />
      ) : (
        <>
          <ol className="divide-y">
            {shown.map((event) => {
              const { label, Icon } = EVENT_META[event.type] ?? { label: event.type.replace(/_/g, " "), Icon: History };
              return (
                <li key={event.id}>
                  <DataRow
                    icon={<Icon aria-hidden />}
                    title={event.lineName ? `${label} · ${event.lineName}` : label}
                    subtitle={
                      <>
                        {event.actor ?? "System"}
                        {event.amount !== null ? <span className="tabular-nums"> · {aed(event.amount)} before VAT</span> : null}
                        {event.note ? (
                          <span className="text-foreground/80"> · &quot;{event.type === "invoiced" ? `MAHER ${event.note}` : event.note}&quot;</span>
                        ) : null}
                      </>
                    }
                    trailing={
                      <span className="text-muted-foreground text-xs" title={at(event.at)}>
                        {formatWhen(event.at)}
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ol>
          <ListPager page={page} pageSize={pageSize} total={events.length} onPageChange={setPage} onPageSizeChange={setPageSize} noun="entries" className="border-t" />
        </>
      )}
    </SectionCard>
  );
}

/* ---------------------------------------------------------------------
   The MAHER invoices: a card each, its total and who recorded it on top,
   the lines it covers under it before VAT; the total includes VAT (2 Nov).
   --------------------------------------------------------------------- */

function InvoicesCard({ workOrderId, invoices }: { workOrderId: string; invoices: WorkOrderInvoice[]; lines: WorkOrderLine[] }) {
  return (
    <SectionCard
      icon={<ReceiptText />}
      title="MAHER invoices"
      description="Every invoice recorded against this work order's lines, and what each covers. Line amounts are before VAT; each invoice's total includes VAT."
      bodyClassName="border-t"
    >
      {invoices.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="size-6" />}
          title="No invoice recorded yet"
          description="Invoices recorded with Record invoice appear here, with the lines each covers."
        />
      ) : (
        <ul className="grid gap-3 p-4">
          {invoices.map((inv) => (
            <li key={inv.id} className="bg-card overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-start gap-3 p-4">
                <span className="border-brand/20 bg-brand-50 text-brand flex size-10 shrink-0 items-center justify-center rounded-lg border">
                  <ReceiptText className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">MAHER {inv.number}</p>
                    {/* The MAHER file recorded with it opens in a new tab. */}
                    {inv.hasFile ? (
                      <Badge variant="outline" className="hover:bg-muted font-normal" asChild>
                        <a href={financeService.invoiceFileUrl(workOrderId, inv.id)} target="_blank" rel="noopener noreferrer">
                          <Paperclip className="size-3" />
                          Open file
                          <ExternalLink className="size-3" />
                        </a>
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Invoice date {formatZonedDate(inv.date)} · recorded by {inv.recordedBy ?? "—"} · {formatWhen(inv.recordedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground text-xs">Total incl. VAT</p>
                  <p className="text-lg font-semibold tabular-nums">{aed(inv.total)}</p>
                </div>
              </div>
              <div className="bg-muted/30 border-t">
                <p className="text-muted-foreground px-4 pt-2.5 pb-1 text-xs font-medium">
                  Covers {inv.allocations.length} {inv.allocations.length === 1 ? "line" : "lines"}
                </p>
                <ul className="divide-y">
                  {inv.allocations.map((a) => (
                    <li key={a.lineId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 truncate" title={a.lineName ?? a.lineId}>
                        {a.lineName ?? a.lineId}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{aed(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ---------------------------------------------------------------------
   The quotation as the client received it, drawn by the same template as
   the job page's Quotation tab and the Extensions screens, from what FSM
   holds; where it stands in FSM above it.
   --------------------------------------------------------------------- */

function QuotationDocument({
  quotation,
  document,
}: {
  quotation: NonNullable<WorkOrderDetail["quotation"]>;
  document: NonNullable<NonNullable<WorkOrderDetail["quotation"]>["document"]>;
}) {
  const link = fsmRecordLink("Estimates", quotation.id);
  const discounted = (document.discountAmount ?? 0) > 0 || document.lineItems.some((l) => (l.discountAmount ?? 0) > 0);
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <FileText />
        <AlertTitle>
          Quotation {quotation.number ?? ""}
          {quotation.status ? ` · ${quotation.status} in FSM` : ""}
        </AlertTitle>
        <AlertDescription>
          {[
            quotation.ownerName ? `Owner ${quotation.ownerName}` : null,
            quotation.postToMaher ? `Post to MAHER: ${quotation.postToMaher}` : null,
            quotation.expiryDate ? `valid until ${formatZonedDate(quotation.expiryDate)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "As held in Zoho FSM."}
        </AlertDescription>
        {link ? (
          <AlertAction>
            <Button asChild size="sm" variant="outline">
              <a href={link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                Open in FSM
              </a>
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
      <Card className="mx-auto w-fit max-w-full overflow-x-auto p-0">
        <YallaClassicTemplate data={document} type="review" hideDiscount={!discounted} />
      </Card>
      <p className="text-muted-foreground text-center text-xs">As read from Zoho FSM; edit the quotation there.</p>
    </div>
  );
}

const BAND_TONES = {
  warning: "border-warning/30 bg-warning/5",
  good: "border-success/30 bg-success/5",
  brand: "border-brand/20 bg-brand-50/40",
  neutral: "bg-muted/40",
} as const;

/** The strip along the header card's bottom edge saying where the work order stands (the inspection header's band). */
function Band({ tone, icon, title, children }: { tone: keyof typeof BAND_TONES; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("border-t px-5 py-3", BAND_TONES[tone])}>
      <p className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        {title}
      </p>
      <div className="text-muted-foreground mt-1 text-sm">{children}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

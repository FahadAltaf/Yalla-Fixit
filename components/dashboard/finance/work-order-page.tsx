"use client";

import { useMemo, useState } from "react";
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
  MessageSquareReply,
  Paperclip,
  PauseCircle,
  PlayCircle,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Undo2,
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
import { INVOICE_STATUS_LABELS, lineCanBeInvoiced, withoutVat, withVat } from "@/lib/finance/line-status";
import { formatZonedDate, formatZonedDateTime, todayInZone } from "@/lib/scheduling/org-time";
import type { WorkOrderDetail, WorkOrderEvent, WorkOrderEventType, WorkOrderInvoice, WorkOrderLine } from "@/lib/server/finance/work-orders";
import { cn } from "@/lib/utils";
import { financeService } from "@/modules/finance/finance-service";

import { EvidenceLinks, ExclusionDialog, uploadEvidenceFiles } from "./exclusion-dialog";
import { InvoiceStatusBadge, InvoiceTotals, WorkOrderQueueBadge, WorkOrderStatusBadge, aed, daysSince } from "./shared";
import { UploadInvoiceDialog } from "./upload-invoice-dialog";

/**
 * One work order in Ready to invoice (laid out like the inspection
 * detail), read live from Zoho FSM: the header card with its status, what
 * it waits on and the actions the person may take; four figures; then
 * tabs for its line items, invoices, history and quotation.
 *
 * Invoicing by line (22 Oct; 23 Oct): only lines completed in FSM (or on a
 * completed work order) can be invoiced, in full or in part, by uploading
 * the MAHER invoice or entering its details; anything else says why in a
 * dialog. An invoice moves the work order to In Progress by itself. The
 * workflow (BRD 5.1 Step 4): query, hold, resume; not to be invoiced with
 * evidence, verified or rejected. Every change asks first. Stored in the
 * portal; FSM is only read.
 *
 * Cached in the browser and on the server for ten minutes, so going back
 * and opening it again costs no FSM call; Refresh reads it again.
 */

type Can = { view: boolean; work: boolean; invoice: boolean; coordinate: boolean; verify: boolean; markReady: boolean };
type Detail = WorkOrderDetail & { can: Can };
type Action = "raise_query" | "answer_query" | "put_on_hold" | "resume";
type NoteAsk = {
  action: Action | "reject_exclusion";
  title: string;
  description: string;
  label: string;
  submit: string;
  /** Asked once the note is written, before anything changes. */
  confirm: { title: string; description: string; destructive?: boolean };
};

const DETAIL_STALE_MS = 10 * 60_000;
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
  exclusion_verified: { label: "Exclusion verified", Icon: ShieldCheck },
  exclusion_rejected: { label: "Exclusion rejected", Icon: XCircle },
};

const formatWhen = (value: string) =>
  new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function FinanceWorkOrderPage({ id }: { id: string }) {
  const url = `/api/finance/work-orders/${encodeURIComponent(id)}`;
  const { data, loading, error, reload } = useSection<Detail>(url, { staleMs: DETAIL_STALE_MS });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceLines, setInvoiceLines] = useState<WorkOrderLine[] | null>(null);
  /* The upload, limited to the lines ticked (null: every completed line). */
  const [upload, setUpload] = useState<{ only: string[] | null } | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; description: string } | null>(null);
  const [exclusionOpen, setExclusionOpen] = useState(false);
  const [noteAsk, setNoteAsk] = useState<NoteAsk | null>(null);
  const [note, setNote] = useState("");
  const [formSession, setFormSession] = useState(0);
  const { confirm, dialog } = useConfirm();

  /* Run a change; the list behind it is stale too, so every cached page is dropped. */
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      setNoteAsk(null);
      setExclusionOpen(false);
      setSelected(new Set());
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

  const { workOrder: wo, quotation, lines, invoicing, can, workflow } = data;
  const linesValue = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const completed = lines.filter((l) => l.status === "Completed");
  const fsmLink = fsmRecordLink("Work_Orders", wo.id);
  const openExclusion = data.exclusions.find((x) => x.decision === null) ?? null;
  const verifiedExclusion = workflow === "excluded" ? ([...data.exclusions].reverse().find((x) => x.decision === "verified") ?? null) : null;
  const live = data.ledgerReady && workflow !== "excluded";
  const canInvoice = can.invoice && live && !openExclusion;
  const invoiceable = (list: WorkOrderLine[]) => list.filter((l) => l.remaining > 0);
  const completedInFsm = (l: WorkOrderLine) => lineCanBeInvoiced(l.status, wo.status);
  const selectable = canInvoice;
  const chosen = lines.filter((l) => selected.has(l.id));
  /* With VAT, each line at its own rate. */
  const vatSum = (list: WorkOrderLine[], amountOf: (l: WorkOrderLine) => number) => round2(list.reduce((sum, l) => sum + withVat(amountOf(l), l), 0));
  const readyWithVat = vatSum(lines.filter((l) => l.ready), (l) => l.remaining);
  const invoicedWithVat = vatSum(lines, (l) => l.invoicedAmount);
  const remainingWithVat = vatSum(lines, (l) => l.remaining);
  const linesWithVat = vatSum(lines, (l) => l.amount ?? 0);

  const act = (action: Action, label: string, text?: string) =>
    run(label, () => financeService.workOrderAction(id, { action, expectedStatus: workflow, note: text ?? null }));
  const ask = (dialogAsk: NoteAsk) => {
    setNote("");
    setNoteAsk(dialogAsk);
  };

  /*
    Only work completed in FSM is invoiced (23 Oct). From the header, the
    completed lines with something left; from the lines ticked, all of them
    or none: a line not completed says so instead of being dropped quietly.
  */
  const startInvoice = (how: "record" | "upload", candidates: WorkOrderLine[], picked: boolean) => {
    const waiting = candidates.filter((l) => !completedInFsm(l));
    const usable = candidates.filter(completedInFsm);
    if (!usable.length || (picked && waiting.length)) {
      const them = waiting.length === 1 ? "it" : "them";
      setBlocked({
        title: "Not completed in Zoho FSM",
        description: picked
          ? `${waiting.map((l) => `${l.name ?? "A line"} (${l.status ?? "no status"})`).join(", ")} ${waiting.length === 1 ? "is" : "are"} not completed in Zoho FSM yet. Only completed work can be invoiced: untick ${them}, or invoice ${them} once FSM shows ${them} completed.`
          : `No line of this work order is completed in Zoho FSM yet (the work order is ${wo.status ?? "not completed"}). Only completed work can be invoiced: record the MAHER invoice once FSM shows the work completed.`,
      });
      return;
    }
    if (how === "record") setInvoiceLines(usable);
    else setUpload({ only: picked ? usable.map((l) => l.id) : null });
  };

  /* What this person may do now, by the workflow status (BRD 5.1 Step 4, 6.8). */
  const actions: React.ReactNode[] = [];
  if (canInvoice && invoiceable(lines).length) {
    actions.push(
      <DropdownMenu key="invoice" modal={false}>
        <DropdownMenuTrigger asChild>
          <Button disabled={busy}>
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
  if (can.work && live && ["open", "in_progress", "on_hold"].includes(workflow) && data.queueStatus !== "invoiced") {
    actions.push(
      <Button
        key="query"
        variant="outline"
        disabled={busy}
        onClick={() =>
          ask({
            action: "raise_query",
            title: "Raise a query",
            description: "The coordinators are notified and the work order waits for their answer.",
            label: "Question",
            submit: "Send query",
            confirm: { title: "Send this query?", description: "The coordinators are notified and the work order moves to Query Raised until they answer." },
          })
        }
      >
        <CircleHelp className="size-4" />
        Raise query
      </Button>,
    );
  }
  if (can.work && live && ["open", "in_progress"].includes(workflow) && data.queueStatus !== "invoiced") {
    actions.push(
      <Button
        key="hold"
        variant="outline"
        disabled={busy}
        onClick={() =>
          ask({
            action: "put_on_hold",
            title: "Put on hold",
            description: "Say why, for example a client dispute or missing information.",
            label: "Reason",
            submit: "Put on hold",
            confirm: { title: "Put this work order on hold?", description: "It stays On Hold, with your reason, until someone resumes it." },
          })
        }
      >
        <PauseCircle className="size-4" />
        Put on hold
      </Button>,
    );
  }
  if (can.work && live && workflow === "on_hold") {
    actions.push(
      <Button
        key="resume"
        variant="outline"
        disabled={busy}
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
  if (can.coordinate && live && workflow === "query_raised") {
    actions.push(
      <Button
        key="answer"
        disabled={busy}
        onClick={() =>
          ask({
            action: "answer_query",
            title: "Answer Finance's query",
            description: data.queryText ?? "",
            label: "Answer",
            submit: "Send answer",
            confirm: { title: "Send your answer?", description: "Finance sees it and the work order goes back to where it was before the query." },
          })
        }
      >
        Answer query
      </Button>,
    );
  }
  if (can.coordinate && live && !openExclusion && invoicing.invoicedValue === 0) {
    actions.push(
      <Button
        key="exclude"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setFormSession((n) => n + 1);
          setExclusionOpen(true);
        }}
      >
        Mark not invoiceable
      </Button>,
    );
  }

  /* What the work order waits on, in a band along the header's bottom edge. */
  const band = !data.ledgerReady ? (
    <Band tone="neutral" icon={<Info />} title="Ready marks, workflow and invoices are off">
      Apply migration 20261024100000 to mark work ready, pick it up and record MAHER invoices.
    </Band>
  ) : openExclusion ? (
    <Band tone="warning" icon={<ShieldCheck />} title="Marked not to be invoiced: waiting for verification">
      <p>
        {openExclusion.requestedBy ?? "A coordinator"}: {openExclusion.reason}
        {openExclusion.notes ? ` (${openExclusion.notes})` : ""}
      </p>
      <EvidenceLinks urlOf={(path) => financeService.workOrderEvidenceUrl(id, path)} paths={openExclusion.evidence} />
      {can.verify ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              const ok = await confirm({
                title: "Verify the exclusion?",
                description: "The work order is marked Excluded and is never invoiced.",
                confirmText: "Verify",
              });
              if (ok) void run("Exclusion verified", () => financeService.decideWorkOrderExclusion(openExclusion.id, { decision: "verified" }));
            }}
          >
            Verify exclusion
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              ask({
                action: "reject_exclusion",
                title: "Reject the exclusion",
                description: "The work order stays where it was, with your note.",
                label: "Note",
                submit: "Reject",
                confirm: { title: "Reject the exclusion?", description: "The work order stays to be invoiced, and the coordinator sees your note.", destructive: true },
              })
            }
          >
            Reject
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-xs">It cannot be invoiced until this is decided.</p>
      )}
    </Band>
  ) : verifiedExclusion ? (
    <Band tone="neutral" icon={<ShieldCheck />} title="Not to be invoiced">
      <p>
        {verifiedExclusion.reason}
        {verifiedExclusion.notes ? ` (${verifiedExclusion.notes})` : ""}. Requested by {verifiedExclusion.requestedBy ?? "a coordinator"}, verified by{" "}
        {verifiedExclusion.decidedBy ?? "—"}.
      </p>
      <EvidenceLinks urlOf={(path) => financeService.workOrderEvidenceUrl(id, path)} paths={verifiedExclusion.evidence} />
    </Band>
  ) : workflow === "query_raised" ? (
    <Band tone="warning" icon={<CircleHelp />} title="Waiting for the coordinator to answer">
      {data.queryText ?? "No question recorded."}
    </Band>
  ) : workflow === "on_hold" ? (
    <Band tone="warning" icon={<PauseCircle />} title="On hold">
      {data.holdReason ?? "No reason recorded."}
    </Band>
  ) : invoicing.status === "invoiced" ? (
    <Band tone="good" icon={<ReceiptText />} title="Invoiced in full">
      {aed(invoicing.invoicedValue)} on {data.invoices.length} MAHER {data.invoices.length === 1 ? "invoice" : "invoices"}. These lines are never presented again.
    </Band>
  ) : invoicing.status === "partially_invoiced" ? (
    <Band tone="warning" icon={<ReceiptText />} title="Partially invoiced">
      {aed(invoicedWithVat)} invoiced; {aed(remainingWithVat)} still to invoice, of which {aed(readyWithVat)} is completed in FSM. All incl. VAT.
    </Band>
  ) : invoicing.status === "ready" ? (
    <Band tone="brand" icon={<CheckCheck />} title="Ready to invoice">
      {aed(readyWithVat)} incl. VAT, completed in FSM.
    </Band>
  ) : lines.length ? (
    <Band tone="neutral" icon={<TriangleAlert />} title="Not completed in Zoho FSM">
      Nothing can be invoiced until the work is completed in FSM. The work order is {wo.status ?? "not completed"}.
    </Band>
  ) : null;

  return (
    <div className="flex flex-col gap-4">

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {wo.type ? <Badge variant="outline">{wo.type}</Badge> : null}
              <WorkOrderStatusBadge status={wo.status} />
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
            <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={refreshing || busy} aria-label="Refresh from Zoho FSM" title="Refresh from Zoho FSM">
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
        {band}
        <div className="bg-muted/40 border-t px-5 py-2.5">
          <p className="text-muted-foreground text-xs">
            Read from Zoho FSM {timeAgo(data.fetchedAt)} ({at(data.fetchedAt)}){data.fromCache ? ", kept for ten minutes" : ""}. Refresh reads it again.
          </p>
        </div>
      </Card>

      <Tabs defaultValue="lines">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="lines">
            Line items
            <TabCount value={lines.length} />
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices
            <TabCount value={data.invoices.length} />
          </TabsTrigger>
          <TabsTrigger value="history">
            History
            <TabCount value={data.events.length} />
          </TabsTrigger>
          <TabsTrigger value="quotation">Quotation</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="mt-4 flex flex-col gap-6">
          <StatCardGrid columns={4}>
            <StatCard
              label="Work order value"
              value={aed(wo.grandTotal ?? linesWithVat)}
              headline="Incl. VAT, as totalled in FSM"
            />
            <StatCard
              label="Ready to invoice"
              value={aed(readyWithVat)}
              headline={invoicing.readyValue > 0 ? "Incl. VAT, completed in FSM" : "Nothing completed to invoice"}
              tone={invoicing.readyValue > 0 ? "progress" : "neutral"}
            />
            <StatCard
              label="Invoiced"
              value={aed(invoicedWithVat)}
              headline={
                invoicing.remainingValue > 0
                  ? `${aed(remainingWithVat)} left to invoice`
                  : lines.length
                    ? INVOICE_STATUS_LABELS[invoicing.status]
                    : "No line items"
              }
              tone={invoicing.status === "invoiced" ? "good" : "neutral"}
            />
            <StatCard
              label="Lines completed"
              value={`${completed.length} / ${lines.length}`}
              headline="Completed in FSM"
              caption={wo.completedAt ? `Work order completed ${formatZonedDate(wo.completedAt)}` : "Work order not completed in FSM"}
              tone={lines.length && completed.length === lines.length ? "good" : "neutral"}
            />
          </StatCardGrid>

          <SectionCard
            icon={<ListChecks />}
            title="Line items"
            description="As in Zoho FSM, with where each stands for invoicing. Values are before VAT; the VAT-inclusive amount is under each."
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
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
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
                        <p className="font-medium">{line.name ?? "Line"}</p>
                        {line.description && line.description !== line.name ? (
                          <p className="text-muted-foreground line-clamp-2 max-w-md text-xs">{line.description}</p>
                        ) : null}
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
                        <InvoiceStatusBadge status={line.invoiceStatus} />
                        {line.invoiceStatus === "partially_invoiced" ? (
                          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                            {aed(line.invoicedAmount)} invoiced · {aed(line.remaining)} left
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantity ?? "—"}
                        {line.unit ? <span className="text-muted-foreground"> {line.unit}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{aed(line.unitPrice)}</TableCell>
                      <TableCell className="pr-5 text-right font-medium tabular-nums">
                        {aed(line.amount)}
                        {line.lineAmount !== null && line.lineAmount !== line.amount ? (
                          <div className="text-muted-foreground text-xs font-normal">incl. VAT {aed(line.lineAmount)}</div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="pl-5 font-medium" colSpan={selectable ? 6 : 5}>
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
          <InvoicesCard invoices={data.invoices} lines={lines} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryCard events={data.events} />
        </TabsContent>

        <TabsContent value="quotation" className="mt-4">
          {quotation?.document ? (
            <QuotationDocument quotation={quotation} document={quotation.document} />
          ) : (
          <SectionCard icon={<FileText />} title="Quotation" bodyClassName="px-5 pb-5">
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
              <p className="text-muted-foreground text-sm">This work order has no quotation linked in Zoho FSM.</p>
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
              disabled={!note.trim()}
              onClick={async () => {
                if (!noteAsk) return;
                const ok = await confirm({
                  title: noteAsk.confirm.title,
                  description: noteAsk.confirm.description,
                  confirmText: noteAsk.submit,
                  variant: noteAsk.confirm.destructive ? "destructive" : "default",
                });
                if (!ok) return;
                if (noteAsk.action === "reject_exclusion" && openExclusion) {
                  void run("Exclusion rejected", () => financeService.decideWorkOrderExclusion(openExclusion.id, { decision: "rejected", note: note.trim() }));
                } else if (noteAsk.action !== "reject_exclusion") {
                  void act(noteAsk.action, `${noteAsk.submit}: done`, note.trim());
                }
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
        onClose={() => !busy && setExclusionOpen(false)}
        onSubmit={async ({ files, ...input }) => {
          const ok = await confirm({
            title: "Send for verification?",
            description: "Finance must verify it before the work order is excluded. Until then it cannot be invoiced.",
            confirmText: "Send",
          });
          if (!ok) return;
          void run("Sent for verification", async () => {
            const evidence = await uploadEvidenceFiles(files, (sign) => financeService.signWorkOrderEvidenceUpload(id, sign));
            return financeService.requestWorkOrderExclusion(id, { ...input, evidence });
          });
        }}
      />

      {invoiceLines ? (
        <RecordInvoiceDialog
          workOrderId={id}
          lines={invoiceLines}
          onClose={() => setInvoiceLines(null)}
          onRecorded={() => {
            setInvoiceLines(null);
            setSelected(new Set());
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
  /* Typed with VAT, as on the MAHER invoice; kept before VAT, like FSM's line amounts. */
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(withVat(l.remaining, l))])));
  const leftWithVat = (line: WorkOrderLine) => withVat(line.remaining, line);
  /* The before-VAT part; the last cent of a line paid in full is the line's, not rounding's. */
  const beforeVat = (line: WorkOrderLine, typed: number) => {
    const part = withoutVat(typed, line);
    return part > line.remaining && part - line.remaining <= 0.011 ? line.remaining : part;
  };
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => todayInZone());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const allocations = useMemo(
    () =>
      lines
        .filter((l) => included.has(l.id))
        .map((l) => {
          const typed = Number(amounts[l.id]);
          return { line: l, typed, amount: Number.isFinite(typed) ? beforeVat(l, typed) : NaN };
        }),
    [lines, included, amounts],
  );
  const badLine = allocations.find((a) => !(a.typed > 0) || a.typed > leftWithVat(a.line) + 0.005);
  /* The invoice total is the lines with VAT, never typed (23 Oct); the server works it out the same way. */
  const sumWithVat = round2(allocations.reduce((s, a) => s + (Number.isFinite(a.amount) ? withVat(a.amount, a.line) : 0), 0));
  const valid = allocations.length > 0 && !badLine && number.trim() && date && sumWithVat > 0;

  const submit = async () => {
    const ok = await confirm({
      title: `Record MAHER ${number.trim()}?`,
      description: `${aed(sumWithVat)} incl. VAT, against ${allocations.length} ${allocations.length === 1 ? "line" : "lines"}. It cannot be undone here.`,
      confirmText: "Record invoice",
    });
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await financeService.recordLineInvoice({
        idempotencyKey: key,
        number: number.trim(),
        date,
        total: sumWithVat,
        note: note.trim() || null,
        allocations: allocations.map((a) => ({ line: a.line.id, workOrder: workOrderId, amount: round2(a.amount) })),
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
          <DialogDescription>Tick the lines it covers and how much of each, incl. VAT. The rest stays to invoice later.</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-0.5">
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
                  "rounded-lg border px-3 py-2.5 transition-colors",
                  on ? "border-brand/40 bg-brand-50/40" : "bg-muted/30",
                  over && "border-destructive",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <Checkbox className="mt-0.5" checked={on} onCheckedChange={(checked) => toggle(Boolean(checked))} aria-label={`Include ${line.name ?? "line"}`} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(!on)}>
                    <p className="line-clamp-2 text-sm leading-snug font-medium">{line.name ?? "Line"}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      <span className="text-foreground font-semibold">{aed(left)}</span> left to invoice, incl. VAT
                    </p>
                    {line.invoicedAmount > 0 ? (
                      <p className="text-muted-foreground text-xs tabular-nums">
                        Line value {aed(line.lineAmount ?? withVat(line.amount ?? 0, line))} · {aed(withVat(line.invoicedAmount, line))} invoiced before
                      </p>
                    ) : null}
                  </button>
                </div>

                {on ? (
                  <div className="mt-2.5 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 border-t pt-2.5 pl-6">
                    <div className="grid gap-1">
                      <Label htmlFor={`pct-${line.id}`} className="text-muted-foreground text-xs font-normal">
                        Percent
                      </Label>
                      <div className="relative">
                        <Input
                          id={`pct-${line.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step="0.01"
                          className="h-8 pr-7 text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          value={line.amount ? String(percent) : ""}
                          onChange={(e) => {
                            const p = Number(e.target.value);
                            if (Number.isFinite(p) && line.amount) setAmounts((prev) => ({ ...prev, [line.id]: String(withVat((line.amount! * p) / 100, line)) }));
                          }}
                        />
                        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs">%</span>
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`amt-${line.id}`} className="text-muted-foreground text-xs font-normal">
                        On this invoice, incl. VAT
                      </Label>
                      <div className="relative">
                        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs">AED</span>
                        <Input
                          id={`amt-${line.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          aria-invalid={over || undefined}
                          className={cn("h-8 pl-11 text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", over && "border-destructive")}
                          value={value}
                          onChange={(e) => setAmounts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-2">
                      <p className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>
                        {over
                          ? `More than the ${aed(left)} left.`
                          : typed > 0
                            ? `${aed(Math.max(0, round2(left - typed)))} left after`
                            : "Enter an amount or a %."}
                      </p>
                      {Math.abs(typed - left) >= 0.005 ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto shrink-0 p-0 text-xs"
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
        <InvoiceTotals total={sumWithVat} />

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
        {dialog}
      </ActionDialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------
   History, laid out as the job page's (audit-timeline.tsx): a row per
   change with its icon, what and who, and when; newest or oldest first,
   a page at a time.
   --------------------------------------------------------------------- */

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
   the lines it covers under it, every amount with VAT.
   --------------------------------------------------------------------- */

function InvoicesCard({ invoices, lines }: { invoices: WorkOrderInvoice[]; lines: WorkOrderLine[] }) {
  const lineOf = new Map(lines.map((l) => [l.id, l]));
  const vatOf = (lineId: string, amount: number) => {
    const line = lineOf.get(lineId);
    return line ? withVat(amount, line) : amount;
  };

  return (
    <SectionCard
      icon={<ReceiptText />}
      title="MAHER invoices"
      description="Every invoice recorded against this work order's lines, and what each covers. Amounts incl. VAT."
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
                    {inv.hasFile ? (
                      <Badge variant="outline" className="font-normal">
                        <Paperclip className="size-3" />
                        File attached
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
                      <span className="shrink-0 font-medium tabular-nums">{aed(vatOf(a.lineId, a.amount))}</span>
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

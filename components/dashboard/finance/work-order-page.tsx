"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCheck,
  CircleHelp,
  ExternalLink,
  FileText,
  FileUp,
  History,
  Info,
  ListChecks,
  PauseCircle,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Truck,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { SectionCard, StatCard, StatCardGrid, TabCount, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { refreshAll, useSection } from "@/components/dashboard/snagging/overview/use-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fsmRecordLink } from "@/lib/fsm-links";
import { INVOICE_STATUS_LABELS } from "@/lib/finance/line-status";
import { formatZonedDate, formatZonedDateTime, todayInZone } from "@/lib/scheduling/org-time";
import type { WorkOrderDetail, WorkOrderEventType, WorkOrderLine } from "@/lib/server/finance/work-orders";
import { cn } from "@/lib/utils";
import { financeService } from "@/modules/finance/finance-service";

import { EvidenceLinks, ExclusionDialog, uploadEvidenceFiles } from "./exclusion-dialog";
import { InvoiceStatusBadge, WorkOrderQueueBadge, WorkOrderStatusBadge, aed, daysSince } from "./shared";
import { UploadInvoiceDialog } from "./upload-invoice-dialog";

/**
 * One work order in Ready to invoice (laid out like the inspection
 * detail), read live from Zoho FSM: the header card with its status, what
 * it waits on and the actions the person may take; four figures; then
 * tabs for its line items, invoices, history, quotation and delivery.
 *
 * The queue's workflow, on the work order (BRD 5.1 Step 4): pick up,
 * query, hold, resume, release; not to be invoiced with evidence, verified
 * or rejected. Invoicing by line (22 Oct): mark the whole work order or the
 * lines ticked Ready; record a MAHER invoice in full or in part. Stored in
 * the portal; FSM is only read.
 *
 * Cached in the browser and on the server for ten minutes, so going back
 * and opening it again costs no FSM call; Refresh reads it again.
 */

type Can = { view: boolean; work: boolean; invoice: boolean; coordinate: boolean; verify: boolean; markReady: boolean };
type Detail = WorkOrderDetail & { can: Can };
type Action = "pick_up" | "release" | "raise_query" | "answer_query" | "put_on_hold" | "resume";
type NoteAsk = { action: Action | "reject_exclusion"; title: string; description: string; label: string; submit: string };

const DETAIL_STALE_MS = 10 * 60_000;
const at = (iso: string | null) => (iso ? formatZonedDateTime(iso) : "—");

const EVENT_LABELS: Record<WorkOrderEventType, string> = {
  marked_ready: "Marked ready to invoice",
  unmarked_ready: "Ready mark taken off",
  invoiced: "Invoiced",
  picked_up: "Picked up",
  released: "Released",
  query_raised: "Query raised",
  query_answered: "Query answered",
  put_on_hold: "Put on hold",
  resumed: "Resumed",
  exclusion_requested: "Marked not to be invoiced",
  exclusion_verified: "Exclusion verified",
  exclusion_rejected: "Exclusion rejected",
};

export function FinanceWorkOrderPage({ id }: { id: string }) {
  const url = `/api/finance/work-orders/${encodeURIComponent(id)}`;
  const { data, loading, error, reload } = useSection<Detail>(url, { staleMs: DETAIL_STALE_MS });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceLines, setInvoiceLines] = useState<WorkOrderLine[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
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

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href="/finance/queue">
        <ArrowLeft className="size-4" />
        Ready to invoice
      </Link>
    </Button>
  );

  if (error && !data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
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
        {back}
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
  const canMark = can.markReady && live && !openExclusion;
  const canInvoice = can.invoice && live && !openExclusion;
  const invoiceable = (list: WorkOrderLine[]) => list.filter((l) => l.remaining > 0);
  const selectable = canMark || canInvoice;
  const chosen = lines.filter((l) => selected.has(l.id));
  const notCompleted = lines.filter((l) => l.status !== "Completed" && !l.ready).length;

  const act = (action: Action, label: string, text?: string) =>
    run(label, () => financeService.workOrderAction(id, { action, expectedStatus: workflow, note: text ?? null }));
  const ask = (dialogAsk: NoteAsk) => {
    setNote("");
    setNoteAsk(dialogAsk);
  };
  const markReady = (lineIds: string[] | undefined, ready: boolean) =>
    run(ready ? "Marked ready to invoice" : "Ready mark taken off", () => financeService.setReady(id, { lines: lineIds, ready }));
  const markWholeOrder = async () => {
    const ok = await confirm({
      title: "Mark the work order ready to invoice",
      description:
        notCompleted > 0
          ? `All ${lines.length} lines are marked. ${notCompleted} of them ${notCompleted === 1 ? "is" : "are"} not completed in FSM yet.`
          : `All ${lines.length} lines are marked ready to invoice.`,
      confirmText: "Mark ready",
    });
    if (ok) await markReady(undefined, true);
  };

  /* What this person may do now, by the workflow status (BRD 5.1 Step 4, 6.8). */
  const actions: React.ReactNode[] = [];
  if (can.work && live && workflow === "open" && data.queueStatus !== "invoiced") {
    actions.push(
      <Button key="pick" onClick={() => void act("pick_up", "Picked up")} disabled={busy}>
        Pick up
      </Button>,
    );
  }
  if (canMark && lines.some((l) => !l.ready)) {
    actions.push(
      <Button key="ready" variant="outline" onClick={() => void markWholeOrder()} disabled={busy}>
        <CheckCheck className="size-4" />
        Mark work order ready
      </Button>,
    );
  }
  if (canInvoice && invoiceable(lines).length) {
    actions.push(
      <Button key="upload" variant="outline" onClick={() => setUploadOpen(true)} disabled={busy}>
        <FileUp className="size-4" />
        Upload invoice
      </Button>,
      <Button
        key="invoice"
        variant={workflow === "in_progress" ? "default" : "outline"}
        onClick={() => setInvoiceLines(invoiceable(lines.filter((l) => l.ready)).length ? invoiceable(lines.filter((l) => l.ready)) : invoiceable(lines))}
        disabled={busy}
      >
        <ReceiptText className="size-4" />
        Record invoice
      </Button>,
    );
  }
  if (can.work && live && ["open", "in_progress", "on_hold"].includes(workflow) && data.queueStatus !== "invoiced") {
    actions.push(
      <Button
        key="query"
        variant="outline"
        disabled={busy}
        onClick={() =>
          ask({ action: "raise_query", title: "Raise a query", description: "The coordinators are notified and the work order waits for their answer.", label: "Question", submit: "Send query" })
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
          ask({ action: "put_on_hold", title: "Put on hold", description: "Say why, for example a client dispute or missing information.", label: "Reason", submit: "Put on hold" })
        }
      >
        <PauseCircle className="size-4" />
        Put on hold
      </Button>,
    );
  }
  if (can.work && live && workflow === "on_hold") {
    actions.push(
      <Button key="resume" onClick={() => void act("resume", "Resumed")} disabled={busy}>
        Resume
      </Button>,
    );
  }
  if (can.work && live && workflow === "in_progress") {
    actions.push(
      <Button key="release" variant="ghost" onClick={() => void act("release", "Released")} disabled={busy}>
        Release
      </Button>,
    );
  }
  if (can.coordinate && live && workflow === "query_raised") {
    actions.push(
      <Button
        key="answer"
        disabled={busy}
        onClick={() => ask({ action: "answer_query", title: "Answer Finance's query", description: data.queryText ?? "", label: "Answer", submit: "Send answer" })}
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
            onClick={() => void run("Exclusion verified", () => financeService.decideWorkOrderExclusion(openExclusion.id, { decision: "verified" }))}
          >
            Verify exclusion
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => ask({ action: "reject_exclusion", title: "Reject the exclusion", description: "The work order stays where it was, with your note.", label: "Note", submit: "Reject" })}
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
      {aed(invoicing.invoicedValue)} invoiced; {aed(invoicing.remainingValue)} still to invoice, of which {aed(invoicing.readyValue)} is ready.
    </Band>
  ) : invoicing.status === "ready" ? (
    <Band tone="brand" icon={<CheckCheck />} title="Ready to invoice">
      {aed(invoicing.readyValue)} across {invoicing.readyLines} of {invoicing.lines} lines, before VAT.
    </Band>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {back}

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
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="mt-4 flex flex-col gap-6">
          <StatCardGrid columns={4}>
            <StatCard label="Work order value" value={aed(wo.subTotal)} headline="Before VAT, as totalled in FSM" caption={wo.grandTotal !== null ? `${aed(wo.grandTotal)} with VAT` : undefined} />
            <StatCard
              label="Ready to invoice"
              value={aed(invoicing.readyValue)}
              headline={`${invoicing.readyLines} of ${invoicing.lines} lines ready`}
              caption="Ready and not yet invoiced, before VAT"
              tone={invoicing.readyValue > 0 ? "progress" : "neutral"}
            />
            <StatCard
              label="Invoiced"
              value={aed(invoicing.invoicedValue)}
              headline={invoicing.remainingValue > 0 ? `${aed(invoicing.remainingValue)} still to invoice` : lines.length ? "Nothing left to invoice" : "No line items"}
              caption={INVOICE_STATUS_LABELS[invoicing.status]}
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
                  {canMark ? (
                    <>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void markReady(chosen.map((l) => l.id), true)}>
                        <CheckCheck className="size-4" />
                        Mark ready
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void markReady(chosen.map((l) => l.id), false)}>
                        <Undo2 className="size-4" />
                        Not ready
                      </Button>
                    </>
                  ) : null}
                  {canInvoice && invoiceable(chosen).length ? (
                    <Button size="sm" disabled={busy} onClick={() => setInvoiceLines(invoiceable(chosen))}>
                      <ReceiptText className="size-4" />
                      Invoice selected
                    </Button>
                  ) : null}
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
                        ) : line.ready && line.readyBy ? (
                          <p className="text-muted-foreground mt-1 text-xs">by {line.readyBy}</p>
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
                    <TableCell className="pr-5 text-right font-semibold tabular-nums">{aed(linesValue)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <SectionCard icon={<ReceiptText />} title="MAHER invoices" description="Every invoice recorded against this work order's lines, and what each covers." bodyClassName="border-t">
            {data.invoices.length === 0 ? (
              <p className="text-muted-foreground px-5 py-4 text-sm">No invoice recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {data.invoices.map((inv) => (
                  <li key={inv.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">MAHER {inv.number}</p>
                        <p className="text-muted-foreground text-xs">
                          Dated {formatZonedDate(inv.date)} · recorded by {inv.recordedBy ?? "—"}, {at(inv.recordedAt)}
                          {inv.hasFile ? " · invoice file attached" : ""}
                        </p>
                      </div>
                      <p className="text-sm tabular-nums">
                        Invoice total <span className="font-medium">{aed(inv.total)}</span>
                      </p>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {inv.allocations.map((a) => (
                        <li key={a.lineId} className="flex justify-between gap-3 text-sm">
                          <span className="text-muted-foreground truncate">{a.lineName ?? a.lineId}</span>
                          <span className="tabular-nums">{aed(a.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <SectionCard icon={<History />} title="History" description="Every Ready mark, invoice and status change on this work order, newest first." bodyClassName="px-5 pb-5">
            {data.events.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing yet.</p>
            ) : (
              <ol className="relative ml-1 space-y-5 border-l pl-5">
                {data.events.map((event) => (
                  <li key={event.id} className="relative text-sm">
                    <span className="bg-background border-brand absolute top-1 -left-[25px] size-2.5 rounded-full border-2" aria-hidden />
                    <p className="font-medium">
                      {EVENT_LABELS[event.type]}
                      {event.amount !== null ? <span className="tabular-nums"> · {aed(event.amount)}</span> : null}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {event.lineName ?? "Work order"} · {event.actor ?? "System"} · <span title={at(event.at)}>{timeAgo(event.at)}</span>
                    </p>
                    {event.note ? <p className="mt-1 text-sm">{event.type === "invoiced" ? `MAHER ${event.note}` : event.note}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="quotation" className="mt-4">
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
        </TabsContent>

        <TabsContent value="delivery" className="mt-4">
          <SectionCard icon={<Truck />} title="Delivery" description="Where the work stands in Zoho FSM." bodyClassName="px-5 pb-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Fact label="Work order status" value={wo.status ?? "—"} />
              <Fact label="Completed" value={wo.completedAt ? at(wo.completedAt) : "Not completed in FSM"} />
              <Fact label="Lines completed" value={`${completed.length} of ${lines.length}`} />
              <Fact label="Client contact" value={wo.contactName ?? "—"} />
            </dl>
            <p className="text-muted-foreground mt-4 flex items-start gap-1.5 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              The appointments, crew and the client-signed completion report are in FSM: Zoho&apos;s API does not list a work order&apos;s appointments in one call, and the token cannot read service reports (B-01).
              {fsmLink ? " Open the work order in FSM to see them." : ""}
            </p>
          </SectionCard>
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
              onClick={() => {
                if (!noteAsk) return;
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
        onSubmit={({ files, ...input }) =>
          void run("Sent for verification", async () => {
            const evidence = await uploadEvidenceFiles(files, (sign) => financeService.signWorkOrderEvidenceUpload(id, sign));
            return financeService.requestWorkOrderExclusion(id, { ...input, evidence });
          })
        }
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
      {uploadOpen ? (
        <UploadInvoiceDialog
          workOrderId={id}
          onClose={() => setUploadOpen(false)}
          onRecorded={() => {
            setUploadOpen(false);
            setSelected(new Set());
            refreshAll();
          }}
        />
      ) : null}
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
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.remaining)])));
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => todayInZone());
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const allocations = useMemo(
    () => lines.filter((l) => included.has(l.id)).map((l) => ({ line: l, amount: Number(amounts[l.id]) })),
    [lines, included, amounts],
  );
  const sum = round2(allocations.reduce((s, a) => s + (Number.isFinite(a.amount) ? a.amount : 0), 0));
  const badLine = allocations.find((a) => !(a.amount > 0) || a.amount > a.line.remaining + 0.005);
  const totalNumber = total === "" ? sum : Number(total);
  const valid = allocations.length > 0 && !badLine && number.trim() && date && totalNumber > 0;

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await financeService.recordLineInvoice({
        idempotencyKey: key,
        number: number.trim(),
        date,
        total: round2(totalNumber),
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
      <ActionDialogContent busy={busy} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Record a MAHER invoice</DialogTitle>
          <DialogDescription>
            Tick the lines it covers and how much of each, before VAT: the full amount left, or a part of it as an amount or a %. What is not
            invoiced stays to invoice later.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-4" />
                <TableHead>Line item</TableHead>
                <TableHead className="text-right">Left to invoice</TableHead>
                <TableHead className="w-24 text-right">%</TableHead>
                <TableHead className="w-36 pr-4 text-right">This invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const on = included.has(line.id);
                const value = amounts[line.id] ?? "";
                const amount = Number(value);
                const over = on && amount > line.remaining + 0.005;
                const percent = line.amount ? round2((amount / line.amount) * 100) : 0;
                return (
                  <TableRow key={line.id}>
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(checked) =>
                          setIncluded((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(line.id);
                            else next.delete(line.id);
                            return next;
                          })
                        }
                        aria-label={`Include ${line.name ?? "line"}`}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{line.name ?? "Line"}</p>
                      <p className="text-muted-foreground text-xs">
                        {aed(line.amount)}
                        {line.invoicedAmount > 0 ? ` · ${aed(line.invoicedAmount)} invoiced before` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{aed(line.remaining)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="0.01"
                        disabled={!on}
                        className="h-8 w-20 text-right"
                        aria-label={`Percent of ${line.name ?? "line"}`}
                        value={on && line.amount ? String(percent) : ""}
                        onChange={(e) => {
                          const p = Number(e.target.value);
                          if (Number.isFinite(p) && line.amount) setAmounts((prev) => ({ ...prev, [line.id]: String(round2((line.amount! * p) / 100)) }));
                        }}
                      />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        disabled={!on}
                        aria-invalid={over || undefined}
                        className={cn("h-8 w-32 text-right", over && "border-destructive")}
                        aria-label={`Amount of ${line.name ?? "line"}`}
                        value={value}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-right text-sm">
          Lines on this invoice: <span className="text-foreground font-medium tabular-nums">{aed(sum)}</span> before VAT
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="maher-number">MAHER invoice number</Label>
            <Input id="maher-number" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="maher-date">Invoice date</Label>
            <Input id="maher-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="maher-total">Invoice total (AED)</Label>
            <Input id="maher-total" type="number" inputMode="decimal" min={0} step="0.01" placeholder={String(sum)} value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="maher-note">Note</Label>
          <Textarea id="maher-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {badLine ? (
          <p className="text-destructive text-sm">
            {badLine.line.name ?? "A line"}: enter an amount above zero and no more than {aed(badLine.line.remaining)}.
          </p>
        ) : null}
        {problem ? <p className="text-destructive text-sm">{problem}</p> : null}

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

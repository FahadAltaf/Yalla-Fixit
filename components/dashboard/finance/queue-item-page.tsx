"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CircleHelp,
  FileText,
  History,
  Info,
  PauseCircle,
  ReceiptText,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeading, SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { QueueAction } from "@/lib/server/finance/queue";
import { financeService, type QueueItemResponse } from "@/modules/finance/finance-service";

import { QueueStatusBadge, TestItemBadge, aed, daysSince, itemCode } from "./shared";

/**
 * One Ready-to-Invoice item (BRD §5.1 Step 3, §6.4, §6.8; DEV-436).
 *
 * Top to bottom as the BRD lists it: header, commercial reference, the
 * line items, the value block, delivery evidence, the activity log; and
 * the actions the person's role allows at this status. Every action sends
 * the status the person was looking at, so if someone else moved the item
 * meanwhile, nothing changes and they are told to reload.
 */

const EVENT_LABELS: Record<string, string> = {
  created: "Entered the queue",
  picked_up: "Picked up",
  released: "Released back to Pending",
  query_raised: "Query raised",
  query_answered: "Query answered",
  put_on_hold: "Put on hold",
  resumed: "Resumed",
  exclusion_requested: "Marked not to be invoiced",
  exclusion_verified: "Exclusion verified",
  exclusion_rejected: "Exclusion rejected",
  invoiced: "Invoiced",
};

const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" })
    : "—";
const dubaiToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

type NoteDialog = {
  action: QueueAction | "reject_exclusion";
  title: string;
  description: string;
  label: string;
  submit: string;
  required: boolean;
};

export function FinanceQueueItemPage({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<QueueItemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteDialog, setNoteDialog] = useState<NoteDialog | null>(null);
  const [note, setNote] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [exclusionOpen, setExclusionOpen] = useState(false);
  /* Each opening of a form is a fresh instance (its key), so it starts
     empty and the invoice gets a new idempotency key. */
  const [formSession, setFormSession] = useState(0);
  const startInvoice = () => {
    setFormSession((n) => n + 1);
    setInvoiceOpen(true);
  };
  const startExclusion = () => {
    setFormSession((n) => n + 1);
    setExclusionOpen(true);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await financeService.getItem(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this item");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) {
    /* A wrong or old link: retrying cannot help, the queue can. */
    if (/no such item|not found/i.test(error)) {
      return (
        <EmptyState
          icon={<ReceiptText />}
          title="This item does not exist"
          description="The link may be wrong, or the item was removed."
          action={{ label: "Back to the queue", onClick: () => router.push("/finance/queue") }}
        />
      );
    }
    return <ErrorState title="Could not load this item" message={error} onRetry={() => void load()} />;
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
        <SectionSkeleton />
      </div>
    );
  }

  const { item, can, value } = data;
  const openExclusion = data.exclusions.find((x) => x.decision === null) ?? null;
  const closed = item.status === "excluded" || item.status === "invoiced";

  /* Run an action; on a refusal, say why and show the latest state. */
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      setNoteDialog(null);
      setInvoiceOpen(false);
      setExclusionOpen(false);
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not go through");
    } finally {
      setBusy(false);
      await load();
    }
  };

  const act = (action: QueueAction, label: string, text?: string) =>
    run(label, () => financeService.act(id, { action, expectedStatus: item.status, note: text ?? null }));

  const askNote = (dialog: NoteDialog) => {
    setNote("");
    setNoteDialog(dialog);
  };

  /* The actions this person may take at this status (BRD §5.1 Step 4, §6.8). */
  const actions: React.ReactNode[] = [];
  if (can.work && item.status === "pending") {
    actions.push(
      <Button key="pick" onClick={() => void act("pick_up", "Picked up")} disabled={busy}>
        Pick up
      </Button>,
    );
  }
  if (can.recordInvoice && (item.status === "in_progress" || item.status === "pending") && !openExclusion) {
    actions.push(
      <Button key="invoice" variant={item.status === "in_progress" ? "default" : "outline"} onClick={startInvoice} disabled={busy}>
        <ReceiptText className="size-4" />
        Record invoice
      </Button>,
    );
  }
  if (can.work && (item.status === "pending" || item.status === "in_progress" || item.status === "on_hold")) {
    actions.push(
      <Button
        key="query"
        variant="outline"
        disabled={busy}
        onClick={() =>
          askNote({
            action: "raise_query",
            title: "Raise a query",
            description: "The coordinator is notified and the item waits for their answer.",
            label: "Question",
            submit: "Send query",
            required: true,
          })
        }
      >
        <CircleHelp className="size-4" />
        Raise query
      </Button>,
    );
  }
  if (can.work && (item.status === "pending" || item.status === "in_progress")) {
    actions.push(
      <Button
        key="hold"
        variant="outline"
        disabled={busy}
        onClick={() =>
          askNote({
            action: "put_on_hold",
            title: "Put on hold",
            description: "Say why, for example a client dispute or missing information.",
            label: "Reason",
            submit: "Put on hold",
            required: true,
          })
        }
      >
        <PauseCircle className="size-4" />
        Put on hold
      </Button>,
    );
  }
  if (can.work && item.status === "on_hold") {
    actions.push(
      <Button key="resume" onClick={() => void act("resume", "Resumed")} disabled={busy}>
        Resume
      </Button>,
    );
  }
  if (can.work && item.status === "in_progress") {
    actions.push(
      <Button key="release" variant="ghost" onClick={() => void act("release", "Released to Pending")} disabled={busy}>
        Release
      </Button>,
    );
  }
  if (can.coordinate && item.status === "query_raised") {
    actions.push(
      <Button
        key="answer"
        disabled={busy}
        onClick={() =>
          askNote({
            action: "answer_query",
            title: "Answer Finance's query",
            description: data.queryText ?? "",
            label: "Answer",
            submit: "Send answer",
            required: true,
          })
        }
      >
        Answer query
      </Button>,
    );
  }
  if (can.coordinate && !closed && !openExclusion) {
    actions.push(
      <Button key="exclude" variant="outline" onClick={startExclusion} disabled={busy}>
        Mark not invoiceable
      </Button>,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/finance/queue">
            <ArrowLeft className="size-4" />
            Ready to invoice
          </Link>
        </Button>
      </div>

      <PageHeading
        eyebrow={`Finance · ${itemCode(item.number)}`}
        title={item.quotationNumber ? `Quotation ${item.quotationNumber}` : (item.workOrderNumber ?? itemCode(item.number))}
        description={[item.clientName, item.quotationNumber ? item.workOrderNumber : null].filter(Boolean).join(" · ")}
        actions={actions.length ? <div className="flex flex-wrap gap-2">{actions}</div> : undefined}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <QueueStatusBadge status={item.status} />
        <span className="text-muted-foreground">
          {daysSince(item.statusChangedAt)} day(s) in this status · entered {dateTime(item.enteredAt)}
        </span>
        {item.assigneeName ? <span className="text-muted-foreground">· with {item.assigneeName}</span> : null}
        {item.isTest ? <TestItemBadge /> : null}
      </div>

      {item.status === "query_raised" && data.queryText ? (
        <Alert>
          <CircleHelp className="size-4" />
          <AlertTitle>Waiting for the coordinator</AlertTitle>
          <AlertDescription>{data.queryText}</AlertDescription>
        </Alert>
      ) : null}
      {item.status === "on_hold" && data.holdReason ? (
        <Alert>
          <PauseCircle className="size-4" />
          <AlertTitle>On hold</AlertTitle>
          <AlertDescription>{data.holdReason}</AlertDescription>
        </Alert>
      ) : null}
      {openExclusion ? (
        <Alert>
          <ShieldCheck className="size-4" />
          <AlertTitle>Marked not to be invoiced: waiting for verification</AlertTitle>
          <AlertDescription>
            <p>
              {openExclusion.requestedBy ?? "A coordinator"}: {openExclusion.reason}
              {openExclusion.notes ? ` (${openExclusion.notes})` : ""}
            </p>
            {can.verify ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run("Exclusion verified", () =>
                      financeService.decideExclusion(openExclusion.id, { decision: "verified" }),
                    )
                  }
                >
                  Verify exclusion
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    askNote({
                      action: "reject_exclusion",
                      title: "Reject the exclusion",
                      description: "The item returns to Pending with your note.",
                      label: "Note",
                      submit: "Reject",
                      required: true,
                    })
                  }
                >
                  Reject
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground mt-1 text-xs">It cannot be invoiced until this is decided.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <SectionCard icon={<FileText />} title="Commercial reference" bodyClassName="px-5 pb-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Fact label="Quotation" value={data.quotation?.number ?? "Not linked in FSM"} />
              <Fact label="Work order" value={item.workOrderNumber ?? item.fsmWorkOrderId} />
              <Fact label="Quotation total (before tax)" value={aed(value.quotationTotal)} />
              <Fact label="Quotation status in FSM" value={(data.quotation?.status as string | undefined) ?? "—"} />
              <Fact label="Client" value={item.clientName ?? "—"} />
              <Fact label="Client contact" value={(data.quotation?.contact_name as string | undefined) ?? "—"} />
              <Fact label="Coordinator (quotation owner)" value={item.coordinatorName ?? "—"} />
            </dl>
          </SectionCard>

          <SectionCard
            icon={<ReceiptText />}
            title="Line items in this item"
            description="Completed in FSM and not invoiced before. Values are before VAT."
            bodyClassName="border-t"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Description</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="pr-5 text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="pl-5">{line.name ?? "Line"}</TableCell>
                    <TableCell className="text-right tabular-nums">{line.quantity ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{aed(line.unitPrice)}</TableCell>
                    <TableCell className="pr-5 text-right font-medium tabular-nums">
                      {aed(line.amount)}
                      {line.lineAmount !== null && line.lineAmount !== line.amount ? (
                        <div className="text-muted-foreground text-xs font-normal">incl. VAT {aed(line.lineAmount)}</div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard icon={<CalendarClock />} title="Delivery evidence" bodyClassName="px-5 pb-5">
            {data.appointments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No appointments found for this work order in the FSM copy.</p>
            ) : (
              <ul className="divide-y">
                {data.appointments.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {a.number ?? "Appointment"} <span className="text-muted-foreground font-normal">· {a.status ?? "—"}</span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Scheduled {dateTime(a.scheduledStart)}
                        {a.actualStart ? ` · worked ${dateTime(a.actualStart)} – ${a.actualEnd ? dateTime(a.actualEnd) : "…"}` : ""}
                      </p>
                    </div>
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs sm:max-w-[45%] sm:text-right">
                      <Users className="size-3.5 shrink-0" />
                      {a.technicians.length ? a.technicians.map((t) => t.name + (t.lead ? " (lead)" : "")).join(", ") : "Crew not recorded"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground mt-4 flex items-start gap-1.5 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              The client-signed completion report cannot be linked yet: the Zoho token cannot read service reports (B-01).
            </p>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-6">
          <SectionCard icon={<Wallet />} title="Value" bodyClassName="px-5 pb-5">
            <dl className="space-y-3 text-sm">
              <Fact label="This item" value={aed(value.thisItem)} strong />
              <Fact label="Invoiced before this item" value={aed(value.cumulativeBefore)} />
              <Fact label="Cumulative with this item" value={aed(value.cumulativeWithThis)} />
              <Fact label="Remaining after this item" value={aed(value.remaining)} />
              <Fact
                label="Completion"
                value={value.completionPercent === null ? "No quotation total" : `${value.completionPercent.toFixed(1)}%`}
                strong
              />
            </dl>
          </SectionCard>

          {data.invoice ? (
            <SectionCard icon={<ReceiptText />} title="Invoice" bodyClassName="px-5 pb-5">
              <dl className="space-y-3 text-sm">
                <Fact label="MAHER invoice" value={data.invoice.number} strong />
                <Fact label="Invoice date" value={new Date(data.invoice.date).toLocaleDateString("en-GB", { dateStyle: "medium" })} />
                <Fact label="Amount" value={aed(data.invoice.amount)} />
                {data.invoice.variance !== 0 ? (
                  <Fact label={`Variance (${aed(data.invoice.variance)})`} value={data.invoice.varianceReason ?? "—"} />
                ) : null}
                <Fact label="Recorded" value={`${data.invoice.recordedBy ?? "—"}, ${dateTime(data.invoice.recordedAt)}`} />
              </dl>
            </SectionCard>
          ) : null}

          <SectionCard icon={<History />} title="Activity" bodyClassName="px-5 pb-5">
            <ol className="space-y-4">
              {[...data.events].reverse().map((event) => (
                <li key={event.id} className="text-sm">
                  <p className="font-medium">{EVENT_LABELS[event.type] ?? event.type}</p>
                  <p className="text-muted-foreground text-xs">
                    {event.actor ?? "System"} · <span title={dateTime(event.at)}>{timeAgo(event.at)}</span>
                  </p>
                  {event.note ? <p className="mt-1 text-sm">{event.note}</p> : null}
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>

      <Dialog open={noteDialog !== null} onOpenChange={(open) => !open && !busy && setNoteDialog(null)}>
        <ActionDialogContent busy={busy}>
          <DialogHeader>
            <DialogTitle>{noteDialog?.title}</DialogTitle>
            {noteDialog?.description ? <DialogDescription>{noteDialog.description}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="finance-note">{noteDialog?.label}</Label>
            <Textarea id="finance-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton
              pending={busy}
              disabled={noteDialog?.required && !note.trim()}
              onClick={() => {
                if (!noteDialog) return;
                if (noteDialog.action === "reject_exclusion" && openExclusion) {
                  void run("Exclusion rejected", () =>
                    financeService.decideExclusion(openExclusion.id, { decision: "rejected", note: note.trim() }),
                  );
                } else {
                  void act(noteDialog.action as QueueAction, `${noteDialog.submit}: done`, note.trim());
                }
              }}
            >
              {noteDialog?.submit}
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>

      <InvoiceDialog
        key={`invoice-${formSession}`}
        open={invoiceOpen}
        busy={busy}
        queueValue={item.value}
        onClose={() => !busy && setInvoiceOpen(false)}
        onSubmit={(input) => void run("Invoice recorded", () => financeService.recordInvoice(id, input))}
      />

      <ExclusionDialog
        key={`exclusion-${formSession}`}
        open={exclusionOpen}
        busy={busy}
        onClose={() => !busy && setExclusionOpen(false)}
        onSubmit={(input) => void run("Sent for verification", () => financeService.requestExclusion(id, input))}
      />
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 sm:block">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</dd>
    </div>
  );
}

function InvoiceDialog({
  open,
  busy,
  queueValue,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  queueValue: number;
  onClose: () => void;
  onSubmit: (input: { idempotencyKey: string; number: string; date: string; amount: number; varianceReason: string | null }) => void;
}) {
  /* One key per opening of the form: a double click or a retry sends the
     same key, and the server returns the first invoice instead of a second. */
  const [key] = useState(() => crypto.randomUUID());
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(dubaiToday);
  const [amount, setAmount] = useState(String(queueValue));
  const [reason, setReason] = useState("");

  const parsed = Number(amount);
  const valid = Boolean(number.trim() && date && Number.isFinite(parsed) && parsed >= 0);
  const differs = valid && Math.round(parsed * 100) !== Math.round(queueValue * 100);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ActionDialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Record the MAHER invoice</DialogTitle>
          <DialogDescription>
            The item moves to Invoiced and its lines are never presented again. Queue value {aed(queueValue)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invoice-number">MAHER invoice number</Label>
            <Input id="invoice-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="invoice-date">Invoice date</Label>
              <Input id="invoice-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invoice-amount">Amount (AED)</Label>
              <Input
                id="invoice-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          {differs ? (
            <div className="grid gap-2">
              <Label htmlFor="invoice-reason">
                Why the amount differs ({aed(Math.round((parsed - queueValue) * 100) / 100)})
              </Label>
              <Textarea id="invoice-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            pending={busy}
            disabled={!valid || (differs && !reason.trim())}
            onClick={() =>
              onSubmit({
                idempotencyKey: key,
                number: number.trim(),
                date,
                amount: Math.round(parsed * 100) / 100,
                varianceReason: differs ? reason.trim() : null,
              })
            }
          >
            Record invoice
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function ExclusionDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { reason: string; notes: string | null }) => void;
}) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ActionDialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Mark not to be invoiced</DialogTitle>
          <DialogDescription>
            For example an AMC PPM visit or an in-contract call-out already paid for. It is excluded only after
            verification, and stays visible in the queue and reports.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="exclusion-reason">Reason</Label>
            <Input id="exclusion-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exclusion-notes">Supporting detail</Label>
            <Textarea id="exclusion-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            <p className="text-muted-foreground text-xs">Attaching files comes in a later step; describe the evidence here for now.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!reason.trim()} onClick={() => onSubmit({ reason: reason.trim(), notes: notes.trim() || null })}>
            Send for verification
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

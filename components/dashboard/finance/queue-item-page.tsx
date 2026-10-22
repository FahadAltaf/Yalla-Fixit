"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ChartNoAxesColumn,
  CircleHelp,
  FileText,
  History,
  Info,
  Paperclip,
  PauseCircle,
  ReceiptText,
  ShieldCheck,
  Users,
  X,
  Wallet,
} from "lucide-react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { SectionCard, StatCard, StatCardGrid, TabCount, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MAX_FILES,
  evidenceContentType,
  evidenceFileName,
} from "@/lib/finance/evidence";
import type { QueueAction } from "@/lib/server/finance/queue";
import { CHART_COLOR } from "@/lib/snagging/chart-palette";
import { cn } from "@/lib/utils";
import { financeService, type QueueItemResponse } from "@/modules/finance/finance-service";

import { QUEUE_STATUS_LABELS, QueueStatusBadge, TestItemBadge, aed, daysSince, itemCode } from "./shared";

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

/* Already invoiced is done, this item is the brand, what remains is neutral. */
const progressConfig = {
  before: { label: "Invoiced before", color: CHART_COLOR.good },
  thisItem: { label: "This item", color: CHART_COLOR.brand },
  remaining: { label: "Remaining", color: CHART_COLOR.neutralSoft },
} satisfies ChartConfig;

function progressTooltip(value: unknown, name: unknown) {
  return (
    <span className="flex w-full items-center justify-between gap-4">
      <span className="text-muted-foreground">{progressConfig[name as keyof typeof progressConfig]?.label ?? String(name)}</span>
      <span className="font-medium tabular-nums">{aed(Number(value))}</span>
    </span>
  );
}

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
  const verifiedExclusion =
    item.status === "excluded" ? (data.exclusions.find((x) => x.decision === "verified") ?? null) : null;
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

  /* What the item is waiting on, said in a band along the header card's
     bottom edge, as the inspection header does. */
  const band = openExclusion ? (
    <HeaderBand tone="warning" icon={<ShieldCheck />} title="Marked not to be invoiced: waiting for verification">
      <p>
        {openExclusion.requestedBy ?? "A coordinator"}: {openExclusion.reason}
        {openExclusion.notes ? ` (${openExclusion.notes})` : ""}
      </p>
      <EvidenceLinks itemId={id} paths={openExclusion.evidence} />
      {can.verify ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run("Exclusion verified", () => financeService.decideExclusion(openExclusion.id, { decision: "verified" }))
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
        <p className="mt-1 text-xs">It cannot be invoiced until this is decided.</p>
      )}
    </HeaderBand>
  ) : item.status === "query_raised" ? (
    <HeaderBand tone="warning" icon={<CircleHelp />} title="Waiting for the coordinator to answer">
      <p>{data.queryText ?? "No question recorded."}</p>
    </HeaderBand>
  ) : item.status === "on_hold" ? (
    <HeaderBand tone="warning" icon={<PauseCircle />} title="On hold">
      <p>{data.holdReason ?? "No reason recorded."}</p>
    </HeaderBand>
  ) : verifiedExclusion ? (
    <HeaderBand tone="neutral" icon={<ShieldCheck />} title="Not to be invoiced">
      <p>
        {verifiedExclusion.reason}
        {verifiedExclusion.notes ? ` (${verifiedExclusion.notes})` : ""}. Requested by{" "}
        {verifiedExclusion.requestedBy ?? "a coordinator"}, verified by {verifiedExclusion.decidedBy ?? "—"}.
      </p>
      <EvidenceLinks itemId={id} paths={verifiedExclusion.evidence} />
    </HeaderBand>
  ) : data.invoice ? (
    <HeaderBand tone="good" icon={<ReceiptText />} title={`Invoiced in MAHER as ${data.invoice.number}`}>
      <p>
        {aed(data.invoice.amount)} on {new Date(data.invoice.date).toLocaleDateString("en-GB", { dateStyle: "medium" })}, recorded by{" "}
        {data.invoice.recordedBy ?? "—"}. These lines are never presented again.
      </p>
    </HeaderBand>
  ) : null;

  const daysInStatus = daysSince(item.statusChangedAt);
  const progress = [
    {
      name: "Quotation",
      before: value.cumulativeBefore,
      thisItem: value.thisItem,
      remaining: Math.max(0, value.remaining ?? 0),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/finance/queue">
          <ArrowLeft className="size-4" />
          Ready to invoice
        </Link>
      </Button>

      {/* The item at a glance and what can be done with it, above the tabs, as on an inspection. */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{itemCode(item.number)}</Badge>
              {item.isTest ? <TestItemBadge /> : null}
              <span className="text-muted-foreground text-xs">Entered {dateTime(item.enteredAt)}</span>
            </div>
            <div className="flex flex-row flex-wrap items-center gap-2">
              <h2 className="text-2xl">
                {item.quotationNumber ? `Quotation ${item.quotationNumber}` : (item.workOrderNumber ?? itemCode(item.number))}
              </h2>
              <QueueStatusBadge status={item.status} />
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                item.clientName,
                item.quotationNumber ? item.workOrderNumber : null,
                item.coordinatorName ? `coordinator ${item.coordinatorName}` : null,
                item.assigneeName ? `with ${item.assigneeName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {actions.length ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {band}
      </Card>

      <Tabs defaultValue="lines">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="lines">
            Line items
            <TabCount value={data.lines.length} />
          </TabsTrigger>
          <TabsTrigger value="commercial">Commercial</TabsTrigger>
          <TabsTrigger value="delivery">
            Delivery evidence
            <TabCount value={data.appointments.length} />
          </TabsTrigger>
          <TabsTrigger value="activity">
            Activity
            <TabCount value={data.events.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="mt-4 flex flex-col gap-6">
          {/* The four figures Finance invoices on, with the lines they count. */}
          <StatCardGrid columns={4}>
            <StatCard
              label="This item"
              value={aed(value.thisItem)}
              headline={`${data.lines.length} completed ${data.lines.length === 1 ? "line" : "lines"}`}
              caption="Before VAT, as priced in FSM"
            />
            <StatCard
              label="Completion"
              value={value.completionPercent === null ? "—" : `${value.completionPercent.toFixed(1)}%`}
              headline={
                value.quotationTotal === null
                  ? "No quotation total in FSM"
                  : `${aed(value.cumulativeWithThis)} of ${aed(value.quotationTotal)}`
              }
              caption="Invoiced before, plus this item"
              tone={value.completionPercent !== null && value.completionPercent >= 100 ? "good" : "neutral"}
            />
            <StatCard
              label="Remaining"
              value={aed(value.remaining)}
              headline={(value.remaining ?? 0) <= 0 ? "Nothing left on the quotation" : "Still to complete and invoice"}
              caption="On the quotation after this item"
            />
            <StatCard
              label="Days in status"
              value={daysInStatus}
              headline={`${QUEUE_STATUS_LABELS[item.status]} since ${dateTime(item.statusChangedAt)}`}
              caption={`Entered the queue ${timeAgo(item.enteredAt)}`}
              tone={!closed && daysInStatus >= 7 ? "progress" : "neutral"}
            />
          </StatCardGrid>

          <SectionCard
            icon={<ChartNoAxesColumn />}
            title="Quotation progress"
            description="Invoiced before, this item, and what remains of the quotation. Worked out from the lines, never typed in."
            bodyClassName="px-5 pb-5"
          >
            {value.quotationTotal ? (
              <>
                <ChartContainer config={progressConfig} className="h-10 w-full">
                  <BarChart data={progress} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }} barSize={22}>
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis type="category" dataKey="name" hide />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={progressTooltip} />} />
                    <Bar dataKey="before" stackId="q" fill="var(--color-before)" radius={[4, 0, 0, 4]} isAnimationActive={false} />
                    <Bar dataKey="thisItem" stackId="q" fill="var(--color-thisItem)" isAnimationActive={false} />
                    <Bar dataKey="remaining" stackId="q" fill="var(--color-remaining)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ChartContainer>
                {/* The legend carries the amounts, so the bar reads without hovering. */}
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["before", value.cumulativeBefore],
                      ["thisItem", value.thisItem],
                      ["remaining", Math.max(0, value.remaining ?? 0)],
                    ] as const
                  ).map(([key, amount]) => (
                    <div key={key} className="flex items-start gap-2">
                      <span className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ background: progressConfig[key].color }} aria-hidden />
                      <div>
                        <dt className="text-muted-foreground text-xs">{progressConfig[key].label}</dt>
                        <dd className="text-sm font-medium tabular-nums">{aed(amount)}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">The quotation has no total in FSM, so its progress cannot be drawn.</p>
            )}
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
                <TableRow className="hover:bg-transparent">
                  <TableCell className="pl-5 font-medium" colSpan={3}>
                    Total
                  </TableCell>
                  <TableCell className="pr-5 text-right font-semibold tabular-nums">{aed(value.thisItem)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        <TabsContent value="commercial" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <SectionCard icon={<FileText />} title="Commercial reference" className="lg:col-span-2" bodyClassName="px-5 pb-5">
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
            </div>
          </div>

          {data.exclusions.length ? (
            <SectionCard
              icon={<ShieldCheck />}
              title="Not-invoiceable requests"
              description="Every request on this item, with its decision and evidence."
              className="mt-6"
              bodyClassName="border-t"
            >
              <ul className="divide-y">
                {[...data.exclusions].reverse().map((x) => (
                  <li key={x.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{x.reason}</p>
                      <p className="text-muted-foreground text-xs">
                        {x.requestedBy ?? "A coordinator"} · {dateTime(x.requestedAt)}
                        {x.notes ? ` · ${x.notes}` : ""}
                      </p>
                      <EvidenceLinks itemId={id} paths={x.evidence} />
                    </div>
                    <p className="text-muted-foreground shrink-0 text-xs sm:text-right">
                      {x.decision === null
                        ? "Waiting for verification"
                        : `${x.decision === "verified" ? "Verified" : "Rejected"} by ${x.decidedBy ?? "—"}${x.decisionNote ? `: ${x.decisionNote}` : ""}`}
                    </p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </TabsContent>

        <TabsContent value="delivery" className="mt-4">
          <SectionCard
            icon={<CalendarClock />}
            title="Delivery evidence"
            description="The work order's appointments in FSM: when the work was booked and done, and by whom."
            bodyClassName="px-5 pb-5"
          >
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
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <SectionCard icon={<History />} title="Activity" description="Every status change on this item, newest first." bodyClassName="px-5 pb-5">
            <ol className="relative ml-1 space-y-5 border-l pl-5">
              {[...data.events].reverse().map((event) => (
                <li key={event.id} className="relative text-sm">
                  <span className="bg-background border-brand absolute top-1 -left-[25px] size-2.5 rounded-full border-2" aria-hidden />
                  <p className="font-medium">{EVENT_LABELS[event.type] ?? event.type}</p>
                  <p className="text-muted-foreground text-xs">
                    {event.actor ?? "System"} · <span title={dateTime(event.at)}>{timeAgo(event.at)}</span>
                  </p>
                  {event.note ? <p className="mt-1 text-sm">{event.note}</p> : null}
                </li>
              ))}
            </ol>
          </SectionCard>
        </TabsContent>
      </Tabs>

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
        onSubmit={({ files, ...input }) =>
          void run("Sent for verification", async () => {
            const evidence = await uploadEvidence(id, files);
            return financeService.requestExclusion(id, { ...input, evidence });
          })
        }
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
  onSubmit: (input: { reason: string; notes: string | null; files: File[] }) => void;
}) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const addFiles = (picked: FileList | null) => {
    const next = [...files];
    for (const file of Array.from(picked ?? [])) {
      if (!evidenceContentType(file.name, file.type)) {
        toast.error(`${file.name}: PDF, image, email or Office files only`);
      } else if (file.size > EVIDENCE_MAX_BYTES) {
        toast.error(`${file.name} is over 10 MB`);
      } else if (next.length >= EVIDENCE_MAX_FILES) {
        toast.error(`Up to ${EVIDENCE_MAX_FILES} files`);
        break;
      } else if (!next.some((f) => f.name === file.name && f.size === file.size)) {
        next.push(file);
      }
    }
    setFiles(next);
  };
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
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exclusion-files">Evidence</Label>
            <Input
              id="exclusion-files"
              type="file"
              multiple
              accept={EVIDENCE_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="text-muted-foreground text-xs">
              The AMC contract page, the client&apos;s email or similar. PDF, image, email or Office files, up to 10 MB
              each.
            </p>
            {files.length ? (
              <ul className="grid gap-1">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 text-sm">
                    <Paperclip className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">{fileSize(file.size)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={busy}
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setFiles(files.filter((f) => f !== file))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!reason.trim()} onClick={() => onSubmit({ reason: reason.trim(), notes: notes.trim() || null, files })}>
            Send for verification
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Each file straight to the private bucket through a one-time URL; returns the stored paths. */
async function uploadEvidence(itemId: string, files: File[]) {
  const paths: string[] = [];
  for (const file of files) {
    const signed = await financeService.signEvidenceUpload(itemId, {
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    });
    const res = await fetch(signed.signedUrl, {
      method: "PUT",
      headers: { "content-type": signed.contentType },
      body: file,
    });
    if (!res.ok) throw new Error(`${file.name} did not upload. Nothing was sent; try again.`);
    paths.push(signed.path);
  }
  return paths;
}

function EvidenceLinks({ itemId, paths }: { itemId: string; paths: string[] }) {
  if (!paths.length) return <p className="text-muted-foreground mt-1 text-xs">No files attached.</p>;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {paths.map((path) => (
        <li key={path}>
          <a
            href={financeService.evidenceUrl(itemId, path)}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-muted hover:bg-muted/70 inline-flex max-w-64 items-center gap-1.5 rounded-md px-2 py-1 text-xs"
          >
            <Paperclip className="size-3.5 shrink-0" />
            <span className="truncate">{evidenceFileName(path)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const BAND_TONES = {
  warning: "border-warning/30 bg-warning/5",
  good: "border-success/30 bg-success/5",
  neutral: "bg-muted/40",
} as const;

/** The strip along the header card's bottom edge saying what the item waits on (the inspection header's band). */
function HeaderBand({
  tone,
  icon,
  title,
  children,
}: {
  tone: keyof typeof BAND_TONES;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
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

import { Badge } from "@/components/ui/badge";
import type { QueueStatus } from "@/lib/server/finance/queue";
import { INVOICE_STATUS_LABELS, QUEUE_STATUS_LABELS as WORK_ORDER_QUEUE_LABELS, type InvoiceStatus, type QueueStatus as WorkOrderQueueStatus } from "@/lib/finance/line-status";
import { CHART_COLOR } from "@/lib/snagging/chart-palette";
import { cn } from "@/lib/utils";

/** The six statuses, in BRD §5.1 Step 4's words. */
export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  query_raised: "Query Raised",
  on_hold: "On Hold",
  excluded: "Excluded",
  invoiced: "Invoiced",
};

/* The same soft tints as the snagging statuses, so one vocabulary reads across modules. */
const QUEUE_STATUS_STYLES: Record<QueueStatus, string> = {
  pending: "bg-mist text-ink-soft",
  in_progress: "bg-brand-50 text-brand",
  query_raised: "bg-warning/10 text-warning",
  on_hold: "bg-warning/10 text-warning",
  excluded: "bg-mist text-ink-soft",
  invoiced: "bg-success/10 text-success",
};

/**
 * A status's colour in a chart, in the snagging palette's vocabulary:
 * not started is neutral, being worked is the brand, waiting on somebody
 * is amber, the two end states are green (invoiced) and neutral
 * (excluded). On hold takes the lighter brand step so it stays distinct
 * from a query in the same donut.
 */
export const QUEUE_STATUS_COLOR: Record<QueueStatus, string> = {
  pending: CHART_COLOR.neutralSoft,
  in_progress: CHART_COLOR.brand,
  query_raised: CHART_COLOR.progress,
  on_hold: CHART_COLOR.brandSofter,
  excluded: CHART_COLOR.neutral,
  invoiced: CHART_COLOR.good,
};

export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", QUEUE_STATUS_STYLES[status])}>
      {QUEUE_STATUS_LABELS[status]}
    </Badge>
  );
}

/** A test item (created before the trigger exists) is labelled wherever it shows. */
export function TestItemBadge() {
  return (
    <Badge variant="outline" className="rounded-sm text-[10px] font-medium uppercase tracking-wide">
      Test
    </Badge>
  );
}

export function aed(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `AED ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
}

export function itemCode(number: number): string {
  return `FQ-${number}`;
}

/* FSM's work order statuses, in the same soft tints: done is green, being worked is the brand, booked is amber, stopped is grey. */
const WORK_ORDER_STATUS_STYLES: Record<string, string> = {
  Completed: "bg-success/10 text-success",
  Closed: "bg-success/10 text-success",
  "In Progress": "bg-brand-50 text-brand",
  "Scheduled Appointment": "bg-warning/10 text-warning",
  Dispatched: "bg-warning/10 text-warning",
  New: "bg-mist text-ink-soft",
  Cancelled: "bg-mist text-ink-soft",
  "Cannot Complete": "bg-destructive/10 text-destructive",
};

export function WorkOrderStatusBadge({ status }: { status: string | null }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium whitespace-nowrap", WORK_ORDER_STATUS_STYLES[status ?? ""] ?? "bg-mist text-ink-soft")}>
      {status ?? "No status"}
    </Badge>
  );
}

/* Invoicing by line: not started is grey, ready is the brand, part-way is amber, done is green. */
const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  not_ready: "bg-mist text-ink-soft",
  ready: "bg-brand-50 text-brand",
  partially_invoiced: "bg-warning/10 text-warning",
  invoiced: "bg-success/10 text-success",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium whitespace-nowrap", INVOICE_STATUS_STYLES[status])}>
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}

/* Ready to invoice by work order: the queue's tints, plus Not ready (grey) and Partially invoiced (amber). */
const WORK_ORDER_QUEUE_STYLES: Record<WorkOrderQueueStatus, string> = {
  not_ready: "bg-mist text-ink-soft",
  pending: "bg-mist text-ink-soft",
  in_progress: "bg-brand-50 text-brand",
  query_raised: "bg-warning/10 text-warning",
  on_hold: "bg-warning/10 text-warning",
  partially_invoiced: "bg-warning/10 text-warning",
  invoiced: "bg-success/10 text-success",
  excluded: "bg-mist text-ink-soft",
};

export function WorkOrderQueueBadge({ status }: { status: WorkOrderQueueStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium whitespace-nowrap", WORK_ORDER_QUEUE_STYLES[status])}>
      {WORK_ORDER_QUEUE_LABELS[status]}
    </Badge>
  );
}

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

/** A span given in days, as a person reads it: "2.5 days", "6 h", "15 min", "under a minute". */
export function formatDuration(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days >= 1) {
    const rounded = Math.round(days * 10) / 10;
    return `${rounded} ${rounded === 1 ? "day" : "days"}`;
  }
  const hours = days * 24;
  if (hours >= 1) return `${Math.round(hours * 10) / 10} h`;
  const minutes = Math.round(hours * 60);
  return minutes >= 1 ? `${minutes} min` : "under a minute";
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
  "Non-billable": "bg-warning/10 text-warning",
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
  non_billable: "bg-mist text-ink-soft",
  void: "bg-mist text-ink-soft line-through",
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

/** The invoice total: what the lines on it come to, VAT included (worked out, never typed). */
/** The invoice's totals (2 Nov): the lines before VAT, VAT on that total, and the invoice total. */
export function InvoiceTotals({ totals }: { totals: { net: number; vat: number; total: number; ratePercent: number | null } }) {
  return (
    <div className="bg-muted/40 grid gap-1 rounded-lg border p-3 text-sm">
      <div className="text-muted-foreground flex items-center justify-between gap-3">
        <span>Lines, before VAT</span>
        <span className="tabular-nums">{aed(totals.net)}</span>
      </div>
      <div className="text-muted-foreground flex items-center justify-between gap-3">
        <span>VAT{totals.ratePercent !== null ? ` (${totals.ratePercent}% of the total)` : ", at each line's rate"}</span>
        <span className="tabular-nums">{aed(totals.vat)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-1">
        <span className="font-medium">Invoice total</span>
        <span className="font-semibold tabular-nums">{aed(totals.total)}</span>
      </div>
    </div>
  );
}

/**
 * A line item's name, and its description when it says more, one line each
 * cut with "…"; the whole of both in a tooltip on hover. The parent sets the
 * width (a fixed max, or min-w-0 in a flex row).
 */
export function LineName({ name, description, className }: { name: string | null; description?: string | null; className?: string }) {
  const detail = description && description !== name ? description : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("min-w-0 cursor-default", className)}>
          <p className="truncate text-sm font-medium">{name ?? "Line"}</p>
          {detail ? <p className="text-muted-foreground truncate text-xs">{detail}</p> : null}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-sm">
        <p className="font-medium">{name ?? "Line"}</p>
        {detail ? <p className="mt-0.5 opacity-80">{detail}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

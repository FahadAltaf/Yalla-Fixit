import { Badge } from "@/components/ui/badge";
import type { QueueStatus } from "@/lib/server/finance/queue";
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

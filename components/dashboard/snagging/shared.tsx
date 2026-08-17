"use client";

import { AlertTriangle, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  REJECTION_LABELS as REJECTION_RULES,
  REMEDIATION_SLA_HOURS,
} from "@/lib/server/snagging/workflow";

// Generic Kaizen primitives live in the shared module now; re-exported
// here so the snagging screens keep importing them from one place.
export {
  PageHeading,
  StatCard,
  SectionCard,
  PillTabs,
  timeAgo,
  type StatTone,
} from "@/components/dashboard/shared/kaizen";
import type {
  SnaggingRejectionCategory,
  SnaggingSeverity,
  SnaggingSnagStatus,
  SnaggingTaskStatus,
} from "@/types/types";

/**
 * Presentation vocabulary shared by every snagging screen.
 *
 * Severity and status colours are defined once here because the list,
 * the detail view, the approval queue, and the analytics cards all show
 * the same values — three of them disagreeing about what "high" looks
 * like is how a reviewer misreads a report.
 */

/**
 * A snag's position in the walk, in a circle tinted by its severity.
 *
 * The number is the point: severity is never carried by colour alone
 * anywhere in this module, so the circle reads as an index first and a
 * severity cue second.
 */
export function SnagIndex({
  index,
  severity,
}: {
  index: number;
  severity: SnaggingSeverity;
}) {
  const tone =
    severity === "high"
      ? "bg-danger text-white"
      : severity === "medium"
        ? "bg-warning text-white"
        : "bg-ink/25 text-ink";

  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        tone,
      )}
      aria-label={`${SEVERITY_LABELS[severity]} severity, item ${index}`}
    >
      {index}
    </span>
  );
}

/** High / medium / low counts as one compact, colour-plus-value cell. */
export function SeverityCounts({
  high,
  medium,
  low,
}: {
  high: number;
  medium: number;
  low: number;
}) {
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className={high > 0 ? "text-danger font-semibold" : "text-muted-foreground"}>
        {high}
      </span>
      <span className={medium > 0 ? "text-warning font-medium" : "text-muted-foreground"}>
        {medium}
      </span>
      <span className="text-muted-foreground">{low}</span>
    </span>
  );
}

export const TASK_STATUS_LABELS: Record<SnaggingTaskStatus, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted",
  in_review: "In review",
  rejected: "Sent back",
  approved: "Approved",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const TASK_STATUS_STYLES: Record<SnaggingTaskStatus, string> = {
  draft: "bg-mist text-ink-soft",
  assigned: "bg-mist-soft text-ink-soft",
  in_progress: "bg-brand-50 text-brand",
  submitted: "bg-brand-100 text-brand",
  in_review: "bg-brand-100 text-brand",
  rejected: "bg-danger/10 text-danger",
  approved: "bg-success/10 text-success",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-mist text-ink-soft line-through",
};

export function TaskStatusBadge({ status }: { status: SnaggingTaskStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", TASK_STATUS_STYLES[status])}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export const SEVERITY_LABELS: Record<SnaggingSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const SEVERITY_STYLES: Record<SnaggingSeverity, string> = {
  low: "bg-mist text-ink-soft",
  medium: "bg-warning/10 text-warning",
  high: "bg-danger/10 text-danger",
};

export function SeverityBadge({ severity }: { severity: SnaggingSeverity }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", SEVERITY_STYLES[severity])}>
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}

/** §5.2 — the de-snagging status model, in the words a manager uses. */
export const SNAG_STATUS_LABELS: Record<SnaggingSnagStatus, string> = {
  open: "Open",
  pending_verification: "Pending verification",
  verified_closed: "Closed",
  verified_poor_quality: "Poor quality fix",
  verified_not_done: "Not done",
  withdrawn: "Withdrawn",
};

const SNAG_STATUS_STYLES: Record<SnaggingSnagStatus, string> = {
  open: "bg-brand-50 text-brand",
  pending_verification: "bg-warning/10 text-warning",
  verified_closed: "bg-success/10 text-success",
  verified_poor_quality: "bg-warning/15 text-warning",
  verified_not_done: "bg-danger/10 text-danger",
  withdrawn: "bg-mist text-ink-soft",
};

export function SnagStatusBadge({ status }: { status: SnaggingSnagStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", SNAG_STATUS_STYLES[status])}>
      {SNAG_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Short names for the three rejection categories, derived from the
 * definitions the API enforces so a label can never drift from the rule
 * behind it. `REJECTION_RULES` holds the full description, remediation
 * path, and SLA for screens that need to explain the choice.
 */
export const REJECTION_LABELS: Record<SnaggingRejectionCategory, string> = Object.fromEntries(
  Object.entries(REJECTION_RULES).map(([key, value]) => [key, value.title]),
) as Record<SnaggingRejectionCategory, string>;

export { REJECTION_RULES, REMEDIATION_SLA_HOURS };

/**
 * How long is left on an SLA, or how far past it we are (FR-4.06).
 * Returns null when there is no clock running.
 */
export function slaState(dueAt?: string | null): {
  overdue: boolean;
  label: string;
} | null {
  if (!dueAt) return null;

  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return null;

  const diffMs = due - Date.now();
  const overdue = diffMs < 0;
  const hours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
  const minutes = Math.floor((Math.abs(diffMs) % (1000 * 60 * 60)) / (1000 * 60));

  const span = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;

  return { overdue, label: overdue ? `${span} overdue` : `${span} left` };
}

export function SlaBadge({ dueAt }: { dueAt?: string | null }) {
  const state = slaState(dueAt);
  if (!state) return <span className="text-muted-foreground text-sm">—</span>;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        state.overdue ? "text-danger" : "text-muted-foreground",
      )}
    >
      {state.overdue ? (
        <AlertTriangle className="size-3.5" aria-hidden />
      ) : (
        <Clock className="size-3.5" aria-hidden />
      )}
      {state.label}
    </span>
  );
}

/** Everything is quoted in Gulf time; nothing is stored in it. */
const GST = "Asia/Dubai";

export function formatGstDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: GST,
  }).format(date);
}

export function formatGstDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: GST,
  }).format(date);
}

export function formatWindow(startAt?: string | null, endAt?: string | null): string {
  if (!startAt) return "—";
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: GST,
    }).format(new Date(value));

  return endAt ? `${time(startAt)} to ${time(endAt)}` : time(startAt);
}

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  studio: "Studio",
  "1br": "1 Bedroom",
  "2br": "2 Bedroom",
  "3br": "3 Bedroom",
  "4br": "4 Bedroom",
  villa: "Villa",
  townhouse: "Townhouse",
};

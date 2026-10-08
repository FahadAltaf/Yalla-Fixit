"use client";

import { AlarmClock, CalendarClock, Flag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENQUIRY_STAGE, isAtOrAfter } from "@/lib/amc/enquiries";
import { cn } from "@/lib/utils";
import type { EnquiryRecord } from "@/modules/amc-contracts/enquiries-service";

/* Soft-tinted pills in theme tokens, as on Snagging: one tone per part of the pipeline. */
const TONE = {
  early: "bg-brand-50 text-brand",
  proposal: "bg-warning/10 text-warning",
  won: "bg-success/10 text-success",
  lost: "bg-danger/10 text-danger",
  hold: "bg-mist text-ink-soft",
} as const;

export function stageTone(stage: string, stages: readonly string[]): string {
  if (stage === ENQUIRY_STAGE.won) return TONE.won;
  if (stage === ENQUIRY_STAGE.lost) return TONE.lost;
  if (stage === ENQUIRY_STAGE.onHold) return TONE.hold;
  return isAtOrAfter(stages, stage, ENQUIRY_STAGE.proposalPreparation) ? TONE.proposal : TONE.early;
}

export function StageBadge({ stage, stages, className }: { stage: string; stages: readonly string[]; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", stageTone(stage, stages), className)}>
      {stage}
    </Badge>
  );
}

/** A site visit's status (the assessment record under it): draft until completed. */
export function SiteVisitStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium capitalize", status === "completed" ? TONE.won : TONE.hold, className)}>
      {status}
    </Badge>
  );
}

/** Idle and follow-up flags next to the stage. Text plus icon, never colour alone. */
export function EnquiryFlags({ enquiry, compact = false }: { enquiry: Pick<EnquiryRecord, "idle" | "followUp" | "siteVisitRequired">; compact?: boolean }) {
  const flags: React.ReactNode[] = [];
  if (enquiry.idle.state) {
    flags.push(
      <Badge key="idle" variant="secondary" className={cn("gap-1 border-0 font-medium", enquiry.idle.state === "escalate" ? TONE.lost : TONE.proposal)}>
        <AlarmClock className="size-3" />
        {enquiry.idle.state === "escalate" ? `Idle ${enquiry.idle.days}d · escalated` : `Idle ${enquiry.idle.days}d`}
      </Badge>,
    );
  }
  if (enquiry.followUp === "overdue" || enquiry.followUp === "today") {
    flags.push(
      <Badge key="fu" variant="secondary" className={cn("gap-1 border-0 font-medium", enquiry.followUp === "overdue" ? TONE.lost : TONE.early)}>
        <CalendarClock className="size-3" />
        {enquiry.followUp === "overdue" ? "Follow-up overdue" : "Follow-up today"}
      </Badge>,
    );
  }
  if (!compact && enquiry.siteVisitRequired) {
    flags.push(
      <Badge key="sv" variant="secondary" className={cn("gap-1 border-0 font-medium", TONE.hold)}>
        <Flag className="size-3" />
        Site visit required
      </Badge>,
    );
  }
  return flags.length ? <div className="flex flex-wrap gap-1">{flags}</div> : null;
}

/* ------------------------------------------------------------------ */
/* Dates (portal users are in Dubai; inputs use the browser's clock)    */
/* ------------------------------------------------------------------ */

/** An instant as the value of a datetime-local input, in the browser's time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** A datetime-local value back to an instant (ISO with offset), or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Now, or `days` from now at 10:00, as a datetime-local value. */
export function localInputIn(days = 0, hour?: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  if (hour !== undefined) d.setHours(hour, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

/** "14:32" on the viewer's own clock, for the "Updated" note beside Refresh. */
export function formatClock(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

/* ------------------------------------------------------------------ */

/**
 * Label-and-value rows for a record being read, as on Snagging's job setup.
 * A missing value shows an em dash, so the shape of the record stays the same.
 */
export function DetailList({ rows }: { rows: Array<{ label: string; value?: React.ReactNode }> }) {
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
          <dd className="min-w-0 text-right text-sm font-medium">
            {row.value === null || row.value === undefined || row.value === "" ? <span className="text-muted-foreground font-normal">—</span> : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PersonSelect({
  people,
  value,
  onChange,
  placeholder = "Choose a person",
  label,
  allowNone = false,
}: {
  people: Array<{ id: string; name: string; email: string | null }>;
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  label: string;
  allowNone?: boolean;
}) {
  return (
    <Select value={value ?? (allowNone ? "none" : "")} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value="none">Nobody</SelectItem> : null}
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
            {p.email && p.email !== p.name ? <span className="text-muted-foreground"> · {p.email}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

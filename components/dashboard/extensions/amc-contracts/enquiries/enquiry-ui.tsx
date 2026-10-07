"use client";

import { AlarmClock, CalendarClock, Flag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENQUIRY_STAGE, isAtOrAfter } from "@/lib/amc/enquiries";
import { cn } from "@/lib/utils";
import type { EnquiryRecord } from "@/modules/amc-contracts/enquiries-service";

/* Soft-tinted pills, as on the canonical table: one colour family per part of the pipeline. */
const TONE = {
  early: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  proposal: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  lost: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  hold: "bg-muted text-muted-foreground",
} as const;

export function stageTone(stage: string, stages: readonly string[]): string {
  if (stage === ENQUIRY_STAGE.won) return TONE.won;
  if (stage === ENQUIRY_STAGE.lost) return TONE.lost;
  if (stage === ENQUIRY_STAGE.onHold) return TONE.hold;
  return isAtOrAfter(stages, stage, ENQUIRY_STAGE.proposalPreparation) ? TONE.proposal : TONE.early;
}

export function StageBadge({ stage, stages, className }: { stage: string; stages: readonly string[]; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-none font-normal", stageTone(stage, stages), className)}>
      {stage}
    </Badge>
  );
}

/** Idle and follow-up flags next to the stage. Text plus icon, never colour alone. */
export function EnquiryFlags({ enquiry, compact = false }: { enquiry: Pick<EnquiryRecord, "idle" | "followUp" | "siteVisitRequired">; compact?: boolean }) {
  const flags: React.ReactNode[] = [];
  if (enquiry.idle.state) {
    flags.push(
      <Badge key="idle" variant="outline" className={cn("gap-1 font-normal", enquiry.idle.state === "escalate" ? "border-rose-500/40 text-rose-700 dark:text-rose-400" : "border-amber-500/40 text-amber-700 dark:text-amber-400")}>
        <AlarmClock className="size-3" />
        {enquiry.idle.state === "escalate" ? `Idle ${enquiry.idle.days}d · escalated` : `Idle ${enquiry.idle.days}d`}
      </Badge>,
    );
  }
  if (enquiry.followUp === "overdue" || enquiry.followUp === "today") {
    flags.push(
      <Badge key="fu" variant="outline" className={cn("gap-1 font-normal", enquiry.followUp === "overdue" ? "border-rose-500/40 text-rose-700 dark:text-rose-400" : "")}>
        <CalendarClock className="size-3" />
        {enquiry.followUp === "overdue" ? "Follow-up overdue" : "Follow-up today"}
      </Badge>,
    );
  }
  if (!compact && enquiry.siteVisitRequired) {
    flags.push(
      <Badge key="sv" variant="outline" className="gap-1 font-normal">
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

/* ------------------------------------------------------------------ */

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
      <SelectTrigger aria-label={label}>
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

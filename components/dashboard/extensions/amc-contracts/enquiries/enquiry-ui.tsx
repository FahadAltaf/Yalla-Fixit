"use client";

import Link from "next/link";
import { AlarmClock, CalendarClock, Flag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENQUIRY_STAGE, isAtOrAfter } from "@/lib/amc/enquiries";
import { cn } from "@/lib/utils";
import type { EnquiryRecord } from "@/modules/amc-contracts/enquiries-service";
import { formatPhone, phoneHref } from "@/lib/phone/format-phone";
import type { PropertyPlace } from "@/lib/server/amc/business";
import { TruncateIfText } from "@/components/ui/truncated-text";

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
    <Badge variant="secondary" title={stage} className={cn("max-w-full border-0 font-medium", stageTone(stage, stages), className)}>
      {/* A long stage name ends in an ellipsis inside its column rather than running into the next one. */}
      <span className="truncate">{stage}</span>
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
/**
 * A section label with its actions as small icons right beside it (edit the
 * record, open it elsewhere), as the Client and Property headings on the
 * enquiry and site visit pages. Goes inside SubHeading.
 */
export function HeadingWithActions({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="inline-flex items-center gap-0.5 tracking-normal normal-case">{children}</span>
    </span>
  );
}

/** One of those icons; a tooltip names it, as the icon buttons on a client's addresses do. */
export function HeadingIconButton({
  label,
  icon,
  onClick,
  href,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  return (
    <Hint label={label}>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground size-6 [&_svg]:size-3.5"
        aria-label={label}
        onClick={onClick}
        asChild={Boolean(href)}
      >
        {href ? <Link href={href}>{icon}</Link> : icon}
      </Button>
    </Hint>
  );
}

const sqft = (value: number | null | undefined) => (value ? `${value.toLocaleString("en-US")} sq ft` : null);

/**
 * A property as the job's Setup tab lists it (unit, building, community,
 * type, bedrooms, areas, floors, developer, external areas), with AMC's
 * category after the type. Empty values keep their row and show a dash, as
 * the job's do, so every property reads the same way.
 */
export function propertyRows({
  unit,
  place,
  typeLabel,
  category,
}: {
  /** The unit's name, usually a link to the property. */
  unit: React.ReactNode;
  place: PropertyPlace | null | undefined;
  typeLabel: string | null;
  category: string | null;
}): Array<{ label: string; value?: React.ReactNode }> {
  return [
    { label: "Unit", value: unit },
    { label: "Building", value: place?.buildingName },
    { label: "Community", value: place?.community },
    { label: "Type", value: typeLabel },
    { label: "Category", value: category },
    { label: "Bedrooms", value: place?.bedrooms == null ? null : place.bedrooms === 0 ? "Studio" : String(place.bedrooms) },
    { label: "Built-up area", value: sqft(place?.builtUpSqft) },
    { label: "Plot area", value: sqft(place?.plotSqft) },
    { label: "Floors", value: place?.floors ? String(place.floors) : null },
    { label: "Developer", value: place?.developer },
    { label: "External areas", value: place ? (place.externalAreasInScope ? "In scope" : "Not in scope") : null },
  ];
}

/**
 * A client as the job's Setup tab lists them: name, then how to reach
 * them. The phone reads as the international phone input shows it.
 */
export function clientRows({
  name,
  customerRef,
  email,
  phone,
  linkClassName,
}: {
  name: React.ReactNode;
  customerRef?: string | null;
  email: string | null | undefined;
  phone: string | null | undefined;
  linkClassName: string;
}): Array<{ label: string; value?: React.ReactNode }> {
  return [
    { label: "Name", value: name },
    { label: "Customer ID", value: customerRef },
    {
      label: "Email",
      value: email ? (
        <a href={`mailto:${email}`} className={linkClassName}>
          {email}
        </a>
      ) : null,
    },
    {
      label: "Phone",
      value: phone ? (
        <a href={phoneHref(phone)} className={linkClassName}>
          {formatPhone(phone)}
        </a>
      ) : null,
    },
  ];
}

/** Label and value rows; give a row a `key` when two can share a label (two people of the same name). */
export function DetailList({ rows }: { rows: Array<{ key?: string; label: string; value?: React.ReactNode }> }) {
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div key={row.key ?? row.label} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium">
            {row.value === null || row.value === undefined || row.value === "" ? <span className="text-muted-foreground font-normal">—</span> : <TruncateIfText>{row.value}</TruncateIfText>}
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
            {/* One truncating line, so a long email never pushes the field wider. */}
            <span className="truncate">
              {p.name}
              {p.email && p.email !== p.name ? <span className="text-muted-foreground"> · {p.email}</span> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A labelled field for the enquiry forms, with an optional hint under it. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function SimpleSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose",
  allowNone = false,
  noneLabel = "Not set",
}: {
  label: string;
  value: string | null | undefined;
  options: Array<[string, string]>;
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  /** What the empty choice is called ("Stay where it is" for a stage move). */
  noneLabel?: string;
}) {
  return (
    <Select value={value ?? (allowNone ? "none" : "")} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value="none">{noneLabel}</SelectItem> : null}
        {options.map(([k, l]) => (
          <SelectItem key={k} value={k}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

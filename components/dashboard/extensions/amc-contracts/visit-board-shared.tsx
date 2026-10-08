"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarPlus, GripVertical, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONFIRMATION_LABELS, type AccessStatus } from "@/lib/amc/visits";
import { cn } from "@/lib/utils";
import type { BoardData, BoardVisit } from "@/modules/amc-contracts/visits-service";

/**
 * Pieces the visit board's panel, grid and dialogs share: Dubai times,
 * window labels, the confirmation and access badges, and the "To place"
 * card. Dubai has no daylight saving, so a fixed +04:00 is exact.
 */

export type BoardTechnician = BoardData["technicians"][number];
export type BusyBlock = BoardData["busy"][number];

/** What is being dragged: kept in a ref, because dragover cannot read the payload. */
export interface DragPayload {
  kind: "toPlace" | "placed";
  visitId: string;
  /** The row a placed block was picked up from. */
  fromTechnicianId?: string;
  /** Minutes between the block's start and where it was grabbed. */
  grabOffset: number;
  durationMinutes: number;
}

/* The board shows the working day, 07:00 to 20:00. */
export const DAY_START = 7 * 60;
export const DAY_END = 20 * 60;
export const DAY_SPAN = DAY_END - DAY_START;
export const SNAP_MINUTES = 15;
/* A visit dragged in from the panel shows as two hours until the suggestion says otherwise. */
export const DEFAULT_DURATION = 120;

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes after midnight in Dubai on `date` (below 0 or past 1440 when another day). */
export function minutesInDay(iso: string, date: string): number {
  return (Date.parse(iso) - Date.parse(`${date}T00:00:00+04:00`)) / 60_000;
}

export const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(Math.round(minutes) % 60)}`;

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" });
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));

const shortDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A calendar date (YYYY-MM-DD) as "9 Oct". */
export const shortDate = (date: string) => shortDateFormat.format(new Date(`${date}T00:00:00Z`));
/** A calendar date as "Fri, 9 Oct 2026". */
export const longDate = (date: string) => longDateFormat.format(new Date(`${date}T00:00:00Z`));

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const windowLabel = (v: Pick<BoardVisit, "windowStart" | "windowEnd">) => `${shortDate(v.windowStart)}–${shortDate(v.windowEnd)}`;
export const inWindow = (v: Pick<BoardVisit, "windowStart" | "windowEnd">, date: string) => date >= v.windowStart && date <= v.windowEnd;

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The visit's dialog lives on its contract's Schedule tab. */
export const visitHref = (v: Pick<BoardVisit, "contractId" | "id">) => `/extensions/amc-contracts/${v.contractId}?tab=schedule&visit=${v.id}`;

/**
 * The two 400s that ask for a reason rather than refuse: a day outside the
 * service window is a reschedule, and a crew other than the suggested one
 * is an override. Read from the server's sentence, which says exactly that.
 */
export function reasonAsked(message: string): "reason" | "overrideReason" | null {
  if (/outside its service window/i.test(message)) return "reason";
  if (/different crew/i.test(message)) return "overrideReason";
  return null;
}

export const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Interval packing: overlapping blocks in a row go into separate lanes. */
export function packLanes<T extends { start: number; end: number }>(items: T[]): { items: Array<T & { lane: number }>; lanes: number } {
  const ends: number[] = [];
  const packed = [...items]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .map((item) => {
      let lane = ends.findIndex((end) => end <= item.start);
      if (lane === -1) lane = ends.push(item.end) - 1;
      else ends[lane] = item.end;
      return { ...item, lane };
    });
  return { items: packed, lanes: ends.length };
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const TONE = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
} as const;

const CONFIRMATION_BADGES: Record<string, { label: string; tone: keyof typeof TONE }> = {
  pending: { label: "Awaiting client", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  no_answer: { label: "No answer", tone: "danger" },
  declined: { label: "Declined", tone: "danger" },
};

/* Only access that still needs work is flagged; approved or not needed says nothing. */
const ACCESS_BADGES: Partial<Record<AccessStatus, { label: string; tone: keyof typeof TONE }>> = {
  pending: { label: "Access pending", tone: "warning" },
  rejected: { label: "Access rejected", tone: "danger" },
  expired: { label: "Access expired", tone: "danger" },
};

export function ConfirmationBadge({ value }: { value: string | null }) {
  const badge = value ? CONFIRMATION_BADGES[value] : null;
  if (!badge) return null;
  return (
    <Badge
      variant="secondary"
      className={cn("border-0 font-medium", TONE[badge.tone])}
      title={CONFIRMATION_LABELS[value as keyof typeof CONFIRMATION_LABELS]}
    >
      {badge.label}
    </Badge>
  );
}

export function AccessBadge({ value }: { value: AccessStatus | null }) {
  const badge = value ? ACCESS_BADGES[value] : null;
  if (!badge) return null;
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", TONE[badge.tone])}>
      {badge.label}
    </Badge>
  );
}

export function ServiceBadges({ services, max = 3 }: { services: string[]; max?: number }) {
  if (!services.length) return null;
  const shown = services.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <Badge key={s} variant="outline" className="font-normal">
          {s}
        </Badge>
      ))}
      {services.length > max ? (
        <Badge variant="outline" className="text-muted-foreground font-normal" title={services.slice(max).join(", ")}>
          +{services.length - max}
        </Badge>
      ) : null}
    </div>
  );
}

/** The original date stays on a rescheduled visit (the server keeps it for adherence). */
export function RescheduledMark({ original, className }: { original: string | null; className?: string }) {
  if (!original) return null;
  return (
    <span className={cn("text-warning inline-flex items-center gap-1 text-xs font-medium", className)} title={`Rescheduled from ${shortDate(original)}`}>
      <History className="size-3.5" />
      Rescheduled
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The "To place" card                                                 */
/* ------------------------------------------------------------------ */

export function ToPlaceCard({
  visit,
  canEdit,
  onPlace,
  onDragStart,
  onDragEnd,
}: {
  visit: BoardVisit;
  canEdit: boolean;
  onPlace: () => void;
  onDragStart: (visit: BoardVisit) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        /* Firefox starts a drag only with some data set. */
        e.dataTransfer.setData("text/plain", visit.id);
        onDragStart(visit);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "bg-card group rounded-lg border p-3 text-sm transition-colors",
        canEdit && "hover:border-brand/40 cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        {canEdit ? <GripVertical className="text-muted-foreground/60 group-hover:text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden /> : null}
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="truncate font-medium" title={visit.customerName}>
              {visit.customerName || "Client"}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {visit.contractNumber} · Visit {visit.visitNo}
              {visit.propertyLabel ? ` · ${visit.propertyLabel}` : ""}
            </p>
          </div>
          <ServiceBadges services={visit.services} max={2} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs tabular-nums">Window {windowLabel(visit)}</span>
            <ConfirmationBadge value={visit.clientConfirmation} />
            <AccessBadge value={visit.accessStatus} />
          </div>
          <RescheduledMark original={visit.originalTargetDate} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
          <Link href={visitHref(visit)}>
            <ArrowUpRight className="size-3.5" />
            Open visit
          </Link>
        </Button>
        {canEdit ? (
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={onPlace}>
            <CalendarPlus className="size-3.5" />
            Place
          </Button>
        ) : null}
      </div>
    </div>
  );
}

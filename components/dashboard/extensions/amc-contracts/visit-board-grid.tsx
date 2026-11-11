"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, History, Trash2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityAvatar } from "@/components/ui/entity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { PLANNABLE_STATUSES, VISIT_STATUS_LABELS } from "@/lib/amc/ppm";
import { todayInDubai } from "@/lib/amc/contracts";
import { cn } from "@/lib/utils";
import type { BoardVisit } from "@/modules/amc-contracts/visits-service";

import {
  AccessBadge,
  ConfirmationBadge,
  DAY_END,
  DAY_SPAN,
  DAY_START,
  RescheduledMark,
  ServiceBadges,
  SNAP_MINUTES,
  formatTime,
  hhmm,
  minutesInDay,
  packLanes,
  shortDate,
  visitHref,
  type BoardTechnician,
  type BusyBlock,
  type DragPayload,
} from "./visit-board-shared";

/**
 * The day grid (DEV-392, 393): one row per technician, 07:00 to 20:00
 * across. AMC visits are the brand-coloured blocks and the only ones that
 * move; live jobs (grey) and leave (hatched) are there to show who is busy.
 */

const TECH_COL = "w-52 min-w-52";
const LANE_HEIGHT = 44;
const ROW_PAD = 6;
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START + i * 60);
/* Hour lines drawn once per row as a background, not as a div per hour. */
const HOUR_LINES = {
  backgroundImage: "linear-gradient(to right, var(--color-border) 1px, transparent 1px)",
  backgroundSize: `calc(100% / ${HOURS.length}) 100%`,
};
const LEAVE_HATCH = {
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, var(--color-danger) 14%, transparent) 6px 12px)",
};

/* A time as a left offset, and a length as a width, across the day. */
const pct = (minutes: number) => `${((minutes - DAY_START) / DAY_SPAN) * 100}%`;
const spanPct = (minutes: number) => `${(minutes / DAY_SPAN) * 100}%`;
const clampToDay = (m: number) => Math.min(DAY_END, Math.max(DAY_START, m));

type Lane =
  | { kind: "amc"; key: string; start: number; end: number; visit: BoardVisit }
  | { kind: "job"; key: string; start: number; end: number; block: BusyBlock };

export interface GridProps {
  date: string;
  technicians: BoardTechnician[];
  placed: BoardVisit[];
  busy: BusyBlock[];
  canEdit: boolean;
  selected: ReadonlySet<string>;
  onToggleSelect: (visitId: string) => void;
  dragRef: MutableRefObject<DragPayload | null>;
  /** A "To place" card dropped on a row at a time. */
  onDropNew: (visitId: string, technicianId: string, startMinutes: number) => void;
  /** A placed block dropped on a row at a time. */
  onDropPlaced: (visitId: string, fromTechnicianId: string, toTechnicianId: string, startMinutes: number) => void;
  onMove: (visit: BoardVisit) => void;
  onChangeCrew: (visit: BoardVisit) => void;
  onRemove: (visit: BoardVisit) => void;
  technicianName: (fsmId: string) => string;
}

export function VisitBoardGrid(props: GridProps) {
  const { date, technicians, placed, busy, canEdit, dragRef, technicianName } = props;
  const [hover, setHover] = useState<{ technicianId: string; start: number; duration: number } | null>(null);

  /* A drag that ends anywhere (dropped elsewhere, Escape) clears the drop marker. */
  useEffect(() => {
    const clear = () => setHover(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  /* Rows: the roster, plus anyone a placed visit names who is no longer on it. */
  const rows = useMemo(() => {
    const known = new Set(technicians.map((t) => t.fsmId));
    const extra = [...new Set(placed.flatMap((v) => v.technicianIds))].filter((id) => !known.has(id));
    return [
      ...technicians,
      ...extra.map((fsmId) => ({ fsmId, name: technicianName(fsmId), shift: null, role: "Not on the roster", trades: [] }) as BoardTechnician),
    ];
  }, [technicians, placed, technicianName]);

  /* Each technician's blocks in minutes of the board day, packed into lanes once per load. */
  const layout = useMemo(() => {
    const byTech = new Map<string, { lanes: Lane[]; leave: Array<{ key: string; start: number; end: number; title: string }> }>();
    const slot = (id: string) => {
      let entry = byTech.get(id);
      if (!entry) byTech.set(id, (entry = { lanes: [], leave: [] }));
      return entry;
    };
    for (const v of placed) {
      if (!v.scheduledStart || !v.scheduledEnd) continue;
      const start = clampToDay(minutesInDay(v.scheduledStart, date));
      const end = Math.max(start + SNAP_MINUTES, clampToDay(minutesInDay(v.scheduledEnd, date)));
      for (const t of v.technicianIds) slot(t).lanes.push({ kind: "amc", key: `${v.id}-${t}`, start, end, visit: v });
    }
    busy.forEach((b, i) => {
      const start = clampToDay(minutesInDay(b.start, date));
      const end = clampToDay(minutesInDay(b.end, date));
      if (end <= start) return;
      if (b.kind === "leave") slot(b.technicianId).leave.push({ key: `leave-${i}`, start, end, title: b.title });
      else slot(b.technicianId).lanes.push({ kind: "job", key: `job-${i}`, start, end: Math.max(end, start + SNAP_MINUTES), block: b });
    });
    return new Map([...byTech].map(([id, entry]) => [id, { ...packLanes(entry.lanes), leave: entry.leave }]));
  }, [placed, busy, date]);

  /* Where the pointer is, as a snapped start time (the grab offset keeps a moved block under the cursor). */
  const minuteAt = (e: React.DragEvent<HTMLDivElement>, payload: DragPayload) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = DAY_START + ((e.clientX - rect.left) / rect.width) * DAY_SPAN - payload.grabOffset;
    const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.min(DAY_END - SNAP_MINUTES, Math.max(DAY_START, snapped));
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>, technicianId: string) => {
    const payload = dragRef.current;
    if (!canEdit || !payload) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const start = minuteAt(e, payload);
    if (hover?.technicianId !== technicianId || hover.start !== start) setHover({ technicianId, start, duration: payload.durationMinutes });
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>, technicianId: string) => {
    const payload = dragRef.current;
    setHover(null);
    if (!canEdit || !payload) return;
    e.preventDefault();
    const start = minuteAt(e, payload);
    dragRef.current = null;
    if (payload.kind === "toPlace") props.onDropNew(payload.visitId, technicianId, start);
    else props.onDropPlaced(payload.visitId, payload.fromTechnicianId ?? technicianId, technicianId, start);
  };

  const today = todayInDubai();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const nowMinute = date === today ? minutesInDay(new Date(now).toISOString(), date) : null;
  const showNow = nowMinute !== null && nowMinute > DAY_START && nowMinute < DAY_END;

  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[960px]">
        {/* Hour ruler */}
        <div className="bg-muted flex border-b text-xs">
          <div className={cn(TECH_COL, "bg-muted text-muted-foreground sticky left-0 z-20 border-r px-4 py-2 font-medium")}>Technician</div>
          <div className="relative flex-1">
            {HOURS.map((h) => (
              <span key={h} className="text-muted-foreground absolute top-2 pl-1.5 tabular-nums" style={{ left: pct(h) }}>
                {hhmm(h)}
              </span>
            ))}
          </div>
        </div>

        {rows.map((t) => {
          const row = layout.get(t.fsmId);
          const lanes = Math.max(1, row?.lanes ?? 0);
          const height = lanes * LANE_HEIGHT + ROW_PAD * 2;
          const marker = hover?.technicianId === t.fsmId ? hover : null;
          return (
            <div key={t.fsmId} className="flex border-b last:border-b-0">
              <div className={cn(TECH_COL, "bg-card sticky left-0 z-20 flex items-start gap-2.5 border-r px-4 py-2.5")} style={{ minHeight: height }}>
                <EntityAvatar name={t.name} seed={t.fsmId} className="size-7" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={t.name}>
                    {t.name}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">{[t.shift, t.role].filter(Boolean).join(" · ") || "No shift set"}</p>
                  {t.trades.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.trades.map((trade) => (
                        <Badge key={trade} variant="secondary" className="bg-mist text-ink-soft h-4 border-0 px-1.5 text-[10px] font-medium">
                          {TRADE_LABELS[trade]}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div
                className={cn("relative flex-1 transition-colors", marker && "bg-brand-50/60")}
                style={{ ...HOUR_LINES, height }}
                onDragOver={(e) => onDragOver(e, t.fsmId)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
                }}
                onDrop={(e) => onDrop(e, t.fsmId)}
              >
                {row?.leave.map((l) => (
                  <div
                    key={l.key}
                    className="border-danger/30 bg-danger/5 text-danger absolute inset-y-0 border-x px-1.5 pt-0.5 text-[10px] font-medium"
                    style={{ ...LEAVE_HATCH, left: pct(l.start), width: spanPct(l.end - l.start) }}
                    title={`${l.title} (leave)`}
                  >
                    <span className="bg-card/80 rounded px-1">{l.title}</span>
                  </div>
                ))}
                {row?.items.map((item) => {
                  const style = {
                    left: pct(item.start),
                    width: spanPct(item.end - item.start),
                    top: ROW_PAD + item.lane * LANE_HEIGHT,
                    height: LANE_HEIGHT - 4,
                  };
                  return item.kind === "job" ? (
                    <div
                      key={item.key}
                      className="bg-mist text-ink-soft absolute overflow-hidden rounded-md border px-2 py-1 text-xs"
                      style={style}
                      title={`${item.block.title} · ${formatTime(item.block.start)}–${formatTime(item.block.end)} (live job)`}
                    >
                      <p className="truncate font-medium">{item.block.title}</p>
                      <p className="truncate text-[11px] tabular-nums opacity-80">
                        {formatTime(item.block.start)}–{formatTime(item.block.end)}
                      </p>
                    </div>
                  ) : (
                    <PlacedBlock key={item.key} {...props} visit={item.visit} technicianId={t.fsmId} style={style} />
                  );
                })}
                {marker ? (
                  <div
                    className="border-brand bg-brand/10 text-brand pointer-events-none absolute z-10 rounded-md border-2 border-dashed px-2 py-1 text-xs font-medium tabular-nums"
                    style={{
                      left: pct(marker.start),
                      width: spanPct(Math.min(marker.duration, DAY_END - marker.start)),
                      top: ROW_PAD,
                      height: LANE_HEIGHT - 4,
                    }}
                  >
                    {hhmm(marker.start)}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {showNow ? (
          <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-52">
            <div className="bg-brand absolute top-0 bottom-0 w-px" style={{ left: pct(nowMinute ?? DAY_START) }} aria-hidden />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One AMC visit on a row                                              */
/* ------------------------------------------------------------------ */

function PlacedBlock({
  visit,
  technicianId,
  style,
  canEdit,
  selected,
  onToggleSelect,
  dragRef,
  onMove,
  onChangeCrew,
  onRemove,
  technicianName,
}: GridProps & { visit: BoardVisit; technicianId: string; style: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  /* Started or finished visits stay where they are. */
  const movable = canEdit && PLANNABLE_STATUSES.includes(visit.status);
  const isSelected = selected.has(visit.id);
  const time = visit.scheduledStart && visit.scheduledEnd ? `${formatTime(visit.scheduledStart)}–${formatTime(visit.scheduledEnd)}` : "";
  const act = (fn: (v: BoardVisit) => void) => () => {
    setOpen(false);
    fn(visit);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          draggable={movable}
          onDragStart={(e) => {
            if (!visit.scheduledStart || !visit.scheduledEnd) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const track = e.currentTarget.parentElement?.getBoundingClientRect();
            const grabOffset = track ? ((e.clientX - rect.left) / track.width) * DAY_SPAN : 0;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", visit.id);
            dragRef.current = {
              kind: "placed",
              visitId: visit.id,
              fromTechnicianId: technicianId,
              grabOffset,
              durationMinutes: (Date.parse(visit.scheduledEnd) - Date.parse(visit.scheduledStart)) / 60_000,
            };
          }}
          onDragEnd={() => {
            dragRef.current = null;
          }}
          onClick={(e) => {
            /* Shift-click picks blocks for the bulk toolbar instead of opening the card. */
            if (e.shiftKey && movable) {
              e.preventDefault();
              onToggleSelect(visit.id);
            }
          }}
          className={cn(
            "group border-brand/30 bg-brand-100 text-brand absolute overflow-hidden rounded-md border border-l-[3px] border-l-brand px-2 py-1 text-xs outline-none",
            "focus-visible:ring-ring/50 hover:shadow-sm focus-visible:ring-[3px]",
            movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
            isSelected && "ring-brand ring-2 ring-offset-1",
          )}
          style={style}
          title={`${visit.customerName} · ${visit.services.join(", ")} · ${time}`}
        >
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate font-medium">{visit.customerName || visit.contractNumber}</p>
            {visit.originalTargetDate ? <History className="text-warning size-3 shrink-0" aria-label="Rescheduled" /> : null}
            {movable ? (
              <span
                className={cn("shrink-0", isSelected ? "inline-flex" : "hidden group-hover:inline-flex")}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(visit.id)}
                  aria-label={`Select visit ${visit.visitNo} of ${visit.contractNumber}`}
                  className="bg-card size-3.5"
                />
              </span>
            ) : null}
          </div>
          <p className="truncate text-[11px] opacity-80">
            <span className="tabular-nums">{time}</span>
            {visit.services.length ? ` · ${visit.services.join(", ")}` : ""}
          </p>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="space-y-3 p-4">
          <div>
            <p className="font-medium">{visit.customerName || "Client"}</p>
            <p className="text-muted-foreground text-xs">
              {visit.contractNumber} · Visit {visit.visitNo}
              {visit.propertyLabel ? ` · ${visit.propertyLabel}` : ""}
            </p>
          </div>
          <dl className="divide-y text-sm">
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="text-right font-medium tabular-nums">{time || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">Crew</dt>
              <dd className="text-right font-medium">
                {visit.technicianIds.map((id) => technicianName(id) + (id === visit.leadTechnicianId ? " (lead)" : "")).join(", ") || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">Window</dt>
              <dd className="text-right font-medium tabular-nums">
                {shortDate(visit.windowStart)}–{shortDate(visit.windowEnd)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right font-medium">{VISIT_STATUS_LABELS[visit.status] ?? visit.status}</dd>
            </div>
          </dl>
          <ServiceBadges services={visit.services} max={4} />
          <div className="flex flex-wrap items-center gap-1.5">
            <ConfirmationBadge value={visit.clientConfirmation} />
            <AccessBadge value={visit.accessStatus} />
            <RescheduledMark original={visit.originalTargetDate} />
          </div>
          {visit.originalTargetDate ? (
            <p className="text-muted-foreground text-xs">
              Rescheduled from {shortDate(visit.originalTargetDate)}; the original date is kept.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t px-4 py-3">
          {movable ? (
            <>
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger mr-auto" onClick={act(onRemove)}>
                <Trash2 className="size-4" />
                Remove
              </Button>
              <Button variant="outline" size="sm" onClick={act(onMove)}>
                <CalendarClock className="size-4" />
                Move
              </Button>
              <Button variant="outline" size="sm" onClick={act(onChangeCrew)}>
                <Users className="size-4" />
                Crew
              </Button>
            </>
          ) : null}
          <Button asChild size="sm">
            <Link href={visitHref(visit)}>
              <ArrowUpRight className="size-4" />
              Open visit
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
